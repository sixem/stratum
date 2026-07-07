// Catalog reconciliation for filesystem mutations.
//
// Filesystem commands queue this work after user-visible operations complete.
// The reconcile path removes stale catalog rows, then scans any surviving
// changed subtree with the same cancellation signal used by full-drive scans.
use std::path::Path;

use super::{scan, service::IndexedSearchHandle, state};

impl IndexedSearchHandle {
    pub fn reconcile_paths(&self, paths: Vec<String>) -> Result<(), String> {
        if self.is_shutting_down() || !self.is_enabled() {
            return Ok(());
        }

        let Some(catalog) = self.inner.catalog.as_ref().cloned() else {
            return Ok(());
        };
        let _write_guard = self
            .inner
            .write_gate
            .lock()
            .expect("indexed search write gate lock");

        let mut refresh_paths = Vec::new();
        let mut touched_drives = std::collections::BTreeSet::new();
        for path in dedupe_reconcile_paths(paths) {
            let Some(drive_path) = self.indexed_drive_path_for_path(&path) else {
                continue;
            };

            touched_drives.insert(drive_path.clone());
            refresh_paths.push(path);
        }

        let mut writer = catalog.begin_write()?;
        writer.remove_path_trees(&refresh_paths)?;

        for path in &refresh_paths {
            if self.should_cancel_scan() {
                return Ok(());
            }

            match std::fs::symlink_metadata(path) {
                Ok(_) => {
                    let should_cancel = || self.should_cancel_scan();
                    if let Err(error) =
                        scan::scan_path_into_writer(Path::new(path), &mut writer, &should_cancel)
                    {
                        if self.should_cancel_scan() && error == scan::SCAN_CANCELLED_MESSAGE {
                            return Ok(());
                        }
                        return Err(error);
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "Failed to reconcile indexed-search path {}: {error}",
                        path
                    ));
                }
            }
        }
        if self.should_cancel_scan() {
            return Ok(());
        }
        writer.finish()?;
        self.bump_catalog_revision();

        for drive_path in touched_drives {
            self.touch_drive_status(&drive_path);
        }

        Ok(())
    }

    fn indexed_drive_path_for_path(&self, path: &str) -> Option<String> {
        let drive_path = drive_root_from_path(path)?;
        let key = state::normalize_drive_key(&drive_path);
        let guard = self.inner.state.lock().expect("indexed search state lock");
        let status = guard.drive_statuses.get(&key)?;
        if !status.indexable {
            return None;
        }
        Some(status.drive_path.clone())
    }
}

fn dedupe_reconcile_paths(paths: Vec<String>) -> Vec<String> {
    let mut ordered = Vec::new();
    let mut seen = std::collections::BTreeSet::new();

    for path in paths {
        let trimmed = trim_reconcile_path(&path);
        if trimmed.is_empty() {
            continue;
        }

        let key = trimmed.to_ascii_lowercase();
        if seen.insert(key) {
            ordered.push(trimmed.to_string());
        }
    }

    ordered.sort_by(|left, right| right.len().cmp(&left.len()).then_with(|| left.cmp(right)));
    ordered
}

fn trim_reconcile_path(path: &str) -> &str {
    let trimmed = path.trim();
    if trimmed.len() <= 3 {
        trimmed
    } else {
        trimmed.trim_end_matches(['\\', '/'])
    }
}

fn drive_root_from_path(path: &str) -> Option<String> {
    let trimmed = trim_reconcile_path(path);
    let bytes = trimmed.as_bytes();
    if bytes.len() < 2 || bytes[1] != b':' {
        return None;
    }

    let drive_letter = trimmed.chars().next()?.to_ascii_uppercase();
    Some(format!("{drive_letter}:\\"))
}
