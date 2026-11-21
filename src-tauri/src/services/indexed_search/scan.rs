// Full drive scans and recursive refreshes of individual paths.
use std::fs;
use std::path::Path;

use crate::domain::indexed_search::IndexedEntryKind;

use super::{
    catalog::{CatalogEntryRecord, IndexedCatalogStore, IndexedCatalogWriter, JournalCheckpoint},
    state::now_epoch_ms,
};

const INSERT_BATCH_SIZE: usize = 2048;
const SCAN_CANCEL_CHECK_INTERVAL: usize = 512;
const SCAN_PROGRESS_LOG_INTERVAL: usize = 25_000;
pub(super) const SCAN_CANCELLED_MESSAGE: &str = "Indexed-search scan cancelled";

pub(super) struct DriveScanSummary {
    pub(super) entries_indexed: usize,
    pub(super) checkpoint: Option<JournalCheckpoint>,
}

pub(super) const FILESYSTEM_SCAN_SOURCE: &str = "Filesystem scan";

pub(super) struct DriveScanCapture<'a> {
    pub(super) drive_path: &'a str,
    pub(super) volume_guid: &'a str,
    pub(super) volume_id: &'a str,
    pub(super) checkpoint: Option<JournalCheckpoint>,
    pub(super) excluded_directory: Option<&'a Path>,
}

// Scans run on background threads, but they still need to exit promptly when
// indexed search is disabled or the app is shutting down. Callers provide the
// cancellation callback so this module stays independent from service state.
pub(super) fn scan_drive_into_catalog(
    catalog: &IndexedCatalogStore,
    capture: &DriveScanCapture<'_>,
    should_cancel: &impl Fn() -> bool,
    validate_mount: &impl Fn() -> Result<(), String>,
) -> Result<DriveScanSummary, String> {
    ensure_scan_not_cancelled(should_cancel)?;
    validate_mount()?;
    let drive_path = capture.drive_path;
    let started_at = now_epoch_ms();

    ensure_scan_not_cancelled(should_cancel)?;
    eprintln!("[indexed-search] scan: filesystem baseline start drive={drive_path}");
    #[cfg(windows)]
    if let Some(summary) =
        super::resumable_scan::scan(catalog, capture, started_at, should_cancel, validate_mount)?
    {
        return Ok(summary);
    }
    // Scan the captured volume even if the drive letter moves mid-scan. The
    // stored paths still use the letter and publication rechecks the binding.
    let drive_root = Path::new(capture.volume_guid);
    let logical_root = Path::new(drive_path);
    let mut writer = catalog.begin_drive_refresh(drive_path)?;
    let mut stack = vec![drive_root.to_path_buf()];
    let mut batch = Vec::with_capacity(INSERT_BATCH_SIZE);
    let mut entries_indexed = 0usize;
    let mut entries_since_cancel_check = 0usize;
    let mut entries_seen = 0usize;
    let mut directories_seen = 0usize;
    let mut next_progress_log = SCAN_PROGRESS_LOG_INTERVAL;

    while let Some(directory) = stack.pop() {
        ensure_scan_not_cancelled(should_cancel)?;
        directories_seen = directories_seen.saturating_add(1);

        #[cfg(windows)]
        let Some((_directory, _pinned, _depth)) = directory
            .strip_prefix(drive_root)
            .ok()
            .and_then(Path::to_str)
            .and_then(|relative| super::resumable_scan::open_frontier(drive_root, relative))
        else {
            // A queued path may have become a junction since its parent was read.
            continue;
        };

        let read_dir = match fs::read_dir(&directory) {
            Ok(value) => value,
            Err(error) if directory == drive_root => {
                return Err(format!(
                    "Failed to read indexed-search drive root {drive_path}: {error}"
                ));
            }
            Err(_) => continue,
        };

        for item in read_dir {
            entries_since_cancel_check = entries_since_cancel_check.saturating_add(1);
            if entries_since_cancel_check >= SCAN_CANCEL_CHECK_INTERVAL {
                ensure_scan_not_cancelled(should_cancel)?;
                entries_since_cancel_check = 0;
            }

            let entry = match item {
                Ok(value) => value,
                Err(error) if directory == drive_root => {
                    return Err(format!(
                        "Failed to list indexed-search drive root {drive_path}: {error}"
                    ));
                }
                Err(_) => continue,
            };
            let path = entry.path();
            let logical_path =
                logical_root.join(path.strip_prefix(drive_root).map_err(|error| {
                    format!("Invalid path while scanning {drive_path}: {error}")
                })?);
            if excluded_path(&logical_path, capture.excluded_directory) {
                continue;
            }
            let metadata = match fs::symlink_metadata(&path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            entries_seen = entries_seen.saturating_add(1);
            let is_directory = metadata.is_dir();
            let kind = if is_directory {
                IndexedEntryKind::Directory
            } else {
                IndexedEntryKind::File
            };

            if let Some(record) = CatalogEntryRecord::from_path(&logical_path, kind) {
                batch.push(record);
            }

            if batch.len() >= INSERT_BATCH_SIZE {
                ensure_scan_not_cancelled(should_cancel)?;
                writer.insert_batch(&batch)?;
                entries_indexed = entries_indexed.saturating_add(batch.len());
                batch.clear();
            }

            if is_directory && can_descend_into(&metadata) {
                stack.push(path);
            }

            if entries_seen >= next_progress_log {
                eprintln!(
                    "[indexed-search] scan: recursive progress drive={} seen={} indexed={} dirs={} pending_dirs={}",
                    drive_path,
                    entries_seen,
                    entries_indexed.saturating_add(batch.len()),
                    directories_seen,
                    stack.len()
                );
                next_progress_log = next_progress_log.saturating_add(SCAN_PROGRESS_LOG_INTERVAL);
            }
        }
    }

    if !batch.is_empty() {
        ensure_scan_not_cancelled(should_cancel)?;
        writer.insert_batch(&batch)?;
        entries_indexed = entries_indexed.saturating_add(batch.len());
    }
    writer.finish_drive_refresh(
        drive_path,
        FILESYSTEM_SCAN_SOURCE,
        started_at,
        capture.volume_id,
        capture.checkpoint,
        || {
            ensure_scan_not_cancelled(should_cancel)?;
            validate_mount()
        },
    )?;
    eprintln!(
        "[indexed-search] scan: filesystem baseline complete drive={} entries={} seen={} dirs={}",
        drive_path, entries_indexed, entries_seen, directories_seen
    );

    Ok(DriveScanSummary {
        entries_indexed,
        checkpoint: capture.checkpoint,
    })
}

pub(super) fn scan_path_into_writer(
    path: &Path,
    logical_path: &Path,
    excluded_directory: Option<&Path>,
    writer: &mut IndexedCatalogWriter,
    should_cancel: &impl Fn() -> bool,
) -> Result<usize, String> {
    ensure_scan_not_cancelled(should_cancel)?;

    let mut batch = Vec::with_capacity(INSERT_BATCH_SIZE);
    let entries_indexed = scan_path_into_writer_with_batch(
        path,
        logical_path,
        excluded_directory,
        writer,
        &mut batch,
        should_cancel,
    )?;
    if !batch.is_empty() {
        ensure_scan_not_cancelled(should_cancel)?;
        writer.insert_batch(&batch)?;
        return Ok(entries_indexed.saturating_add(batch.len()));
    }
    Ok(entries_indexed)
}

fn scan_path_into_writer_with_batch(
    path: &Path,
    logical_path: &Path,
    excluded_directory: Option<&Path>,
    writer: &mut IndexedCatalogWriter,
    batch: &mut Vec<CatalogEntryRecord>,
    should_cancel: &impl Fn() -> bool,
) -> Result<usize, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        format!(
            "Failed to read indexed-search metadata for {}: {error}",
            path.display()
        )
    })?;

    let mut entries_indexed = 0usize;
    let mut entries_since_cancel_check = 0usize;
    let mut stack = vec![(path.to_path_buf(), logical_path.to_path_buf(), metadata)];

    while let Some((current_path, current_logical_path, metadata)) = stack.pop() {
        entries_since_cancel_check = entries_since_cancel_check.saturating_add(1);
        if entries_since_cancel_check >= SCAN_CANCEL_CHECK_INTERVAL {
            ensure_scan_not_cancelled(should_cancel)?;
            entries_since_cancel_check = 0;
        }

        let is_directory = metadata.is_dir();
        let kind = if is_directory {
            IndexedEntryKind::Directory
        } else {
            IndexedEntryKind::File
        };

        if let Some(record) = CatalogEntryRecord::from_path(&current_logical_path, kind) {
            batch.push(record);
        }

        if batch.len() >= INSERT_BATCH_SIZE {
            ensure_scan_not_cancelled(should_cancel)?;
            writer.insert_batch(batch)?;
            entries_indexed = entries_indexed.saturating_add(batch.len());
            batch.clear();
        }

        if !is_directory || !can_descend_into(&metadata) {
            continue;
        }

        let read_dir = match fs::read_dir(&current_path) {
            Ok(value) => value,
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound
                    || error.kind() == std::io::ErrorKind::PermissionDenied =>
            {
                continue;
            }
            Err(error) => {
                return Err(format!(
                    "Failed to read indexed-search directory {}: {error}",
                    current_path.display()
                ));
            }
        };

        for item in read_dir {
            let entry = match item {
                Ok(value) => value,
                Err(_) => continue,
            };
            let child_path = entry.path();
            let child_logical_path = current_logical_path.join(entry.file_name());
            if excluded_path(&child_logical_path, excluded_directory) {
                continue;
            }
            let child_metadata = match fs::symlink_metadata(&child_path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            stack.push((child_path, child_logical_path, child_metadata));
        }
    }

    Ok(entries_indexed)
}

pub(super) fn excluded_path(path: &Path, excluded_directory: Option<&Path>) -> bool {
    let Some(directory) = excluded_directory.and_then(Path::to_str) else {
        return false;
    };
    let Some(path) = path.to_str() else {
        return false;
    };
    // The SQLite catalog and its WAL must never show up in the index or
    // generate reconciliation jobs as the index updates its own files.
    let directory = directory
        .strip_prefix(r"\\?\")
        .unwrap_or(directory)
        .trim_end_matches(['\\', '/']);
    let path = path.strip_prefix(r"\\?\").unwrap_or(path);
    let Some(prefix) = path.get(..directory.len()) else {
        return false;
    };
    let suffix = &path[directory.len()..];
    (suffix.is_empty() || suffix.starts_with(['\\', '/']))
        && prefix.bytes().zip(directory.bytes()).all(|(left, right)| {
            left.eq_ignore_ascii_case(&right)
                || (left == b'/' && right == b'\\')
                || (left == b'\\' && right == b'/')
        })
}

pub(super) fn ensure_scan_not_cancelled(should_cancel: &impl Fn() -> bool) -> Result<(), String> {
    if should_cancel() {
        return Err(SCAN_CANCELLED_MESSAGE.to_string());
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub(super) fn can_descend_into(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
}

#[cfg(not(target_os = "windows"))]
fn can_descend_into(_metadata: &fs::Metadata) -> bool {
    true
}
