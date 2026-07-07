// Background worker orchestration for indexed search.
//
// Lifecycle code decides whether indexing is enabled. This module owns the
// worker threads, drive rebuild requests, and the scan-to-drive-state update
// sequence.
use crate::domain::indexed_search::{IndexedDriveState, IndexedSearchServiceState};

use super::{scan, service::IndexedSearchHandle, state};

impl IndexedSearchHandle {
    pub fn request_drive_rebuild(&self, drive_path: String) -> Result<bool, String> {
        if self.is_shutting_down() || !self.is_enabled() {
            return Ok(false);
        }

        if !self.has_catalog() {
            self.mark_catalog_unavailable();
            return Err(self.catalog_unavailable_message());
        }

        let normalized_key = state::normalize_drive_key(&drive_path);

        {
            let guard = self.inner.state.lock().expect("indexed search state lock");
            let Some(status) = guard.drive_statuses.get(&normalized_key) else {
                return Err("Indexed-search drive not found.".to_string());
            };
            if !status.indexable {
                return Err(
                    "This drive is not indexable in the current indexed-search scope.".to_string(),
                );
            }
            if status.state == IndexedDriveState::Scanning {
                return Ok(false);
            }
            if guard
                .drive_statuses
                .values()
                .any(|drive| drive.state == IndexedDriveState::Scanning)
            {
                return Err("Indexed search is already rebuilding another drive.".to_string());
            }
        }

        self.transition_drive_state(&drive_path, IndexedDriveState::Queued, None);
        self.set_service_state(
            IndexedSearchServiceState::Scanning,
            Some(format!("Rebuilding {drive_path}")),
        );

        let worker = self.clone();
        let spawn_result = std::thread::Builder::new()
            .name("indexed-search-rebuild".to_string())
            .spawn(move || worker.run_requested_rebuild(drive_path));

        match spawn_result {
            Ok(_) => Ok(true),
            Err(error) => {
                self.set_service_state(
                    IndexedSearchServiceState::Error,
                    Some("Indexed-search rebuild failed to start.".to_string()),
                );
                Err(format!("Failed to start indexed-search rebuild: {error}"))
            }
        }
    }

    pub(super) fn spawn_initial_scan(&self) {
        if !self.is_enabled() || self.is_shutting_down() {
            eprintln!(
                "[indexed-search] spawn_initial_scan: skipped enabled={} shutting_down={}",
                self.is_enabled(),
                self.is_shutting_down()
            );
            return;
        }

        if !self.has_catalog() {
            eprintln!("[indexed-search] spawn_initial_scan: catalog unavailable");
            self.mark_catalog_unavailable();
            return;
        }

        let drive_paths = self.pending_scan_drive_paths();
        eprintln!(
            "[indexed-search] spawn_initial_scan: pending_count={} drives={:?}",
            drive_paths.len(),
            drive_paths
        );

        if drive_paths.is_empty() {
            self.set_service_state(IndexedSearchServiceState::Idle, None);
            eprintln!("[indexed-search] spawn_initial_scan: no pending drives, service idle");
            return;
        }

        let worker = self.clone();
        let spawn_result = std::thread::Builder::new()
            .name("indexed-search-scan".to_string())
            .spawn(move || worker.run_initial_scan(drive_paths));

        if let Err(error) = spawn_result {
            eprintln!("[indexed-search] spawn_initial_scan: worker spawn failed: {error}");
            let drive_message = format!("Indexed-search scan worker failed to start: {error}");
            let mut guard = self.inner.state.lock().expect("indexed search state lock");
            guard.mark_indexable_drives_error(&drive_message);
            guard.update_service_status(
                IndexedSearchServiceState::Error,
                Some("Indexed-search scan worker failed to start.".to_string()),
            );
        } else {
            eprintln!("[indexed-search] spawn_initial_scan: worker spawned");
        }
    }

    fn run_initial_scan(&self, drive_paths: Vec<String>) {
        eprintln!(
            "[indexed-search] run_initial_scan: start pending_count={}",
            drive_paths.len()
        );
        for drive_path in drive_paths {
            if self.is_shutting_down() || !self.is_enabled() {
                eprintln!(
                    "[indexed-search] run_initial_scan: stopping before drive={} enabled={} shutting_down={}",
                    drive_path,
                    self.is_enabled(),
                    self.is_shutting_down()
                );
                break;
            }
            self.scan_drive_and_update(&drive_path);
        }

        if self.is_enabled() && !self.is_shutting_down() {
            self.set_service_state(IndexedSearchServiceState::Idle, None);
            eprintln!("[indexed-search] run_initial_scan: finished, service idle");
        }
    }

    fn run_requested_rebuild(&self, drive_path: String) {
        if self.is_shutting_down() || !self.is_enabled() {
            eprintln!(
                "[indexed-search] run_requested_rebuild: skipped drive={} enabled={} shutting_down={}",
                drive_path,
                self.is_enabled(),
                self.is_shutting_down()
            );
            return;
        }

        eprintln!("[indexed-search] run_requested_rebuild: start drive={drive_path}");
        self.scan_drive_and_update(&drive_path);
        if self.is_enabled() && !self.is_shutting_down() {
            self.set_service_state(IndexedSearchServiceState::Idle, None);
            eprintln!("[indexed-search] run_requested_rebuild: finished drive={drive_path}");
        }
    }

    fn scan_drive_and_update(&self, drive_path: &str) {
        if self.is_shutting_down() || !self.is_enabled() {
            eprintln!(
                "[indexed-search] scan_drive: skipped drive={} enabled={} shutting_down={}",
                drive_path,
                self.is_enabled(),
                self.is_shutting_down()
            );
            return;
        }

        let Some(catalog) = self.inner.catalog.as_ref().cloned() else {
            eprintln!("[indexed-search] scan_drive: missing catalog drive={drive_path}");
            self.mark_catalog_unavailable();
            return;
        };

        eprintln!("[indexed-search] scan_drive: start drive={drive_path}");
        self.set_service_state(
            IndexedSearchServiceState::Scanning,
            Some(format!("Indexing {drive_path}")),
        );
        self.transition_drive_state(drive_path, IndexedDriveState::Scanning, None);

        let scan_result = {
            let _write_guard = self
                .inner
                .write_gate
                .lock()
                .expect("indexed search write gate lock");
            let should_cancel = || self.should_cancel_scan();
            scan::scan_drive_into_catalog(&catalog, drive_path, &should_cancel)
        };

        if self.is_shutting_down() || !self.is_enabled() {
            return;
        }

        match scan_result {
            Ok(summary) => {
                let source_label = match summary.source {
                    scan::DriveScanSource::NtfsFastPath => "NTFS fast path",
                    scan::DriveScanSource::RecursiveFallback => "recursive fallback",
                };
                eprintln!(
                    "[indexed-search] scan_drive: scan ok drive={} entries={} source={}",
                    drive_path, summary.entries_indexed, source_label
                );
                if let Err(error) =
                    catalog.mark_drive_scan_ready(drive_path, source_label, state::now_epoch_ms())
                {
                    eprintln!(
                        "[indexed-search] scan_drive: mark ready failed drive={} error={}",
                        drive_path, error
                    );
                    self.transition_drive_state(
                        drive_path,
                        IndexedDriveState::Error,
                        Some(format!(
                            "Indexed-search catalog persistence failed: {error}"
                        )),
                    );
                    return;
                }
                self.transition_drive_state(drive_path, IndexedDriveState::Ready, None);
                self.set_drive_summary(
                    drive_path,
                    Some(summary.entries_indexed as u64),
                    Some(source_label.to_string()),
                );
                self.bump_catalog_revision();
            }
            Err(error) if error == scan::SCAN_CANCELLED_MESSAGE => {
                eprintln!("[indexed-search] scan_drive: cancelled drive={drive_path}");
            }
            Err(error) => {
                eprintln!(
                    "[indexed-search] scan_drive: failed drive={} error={}",
                    drive_path, error
                );
                let _ = catalog.mark_drive_scan_failed(drive_path, state::now_epoch_ms());
                self.transition_drive_state(
                    drive_path,
                    IndexedDriveState::Error,
                    Some(format!("Indexed-search scan failed: {error}")),
                );
            }
        }
    }
}
