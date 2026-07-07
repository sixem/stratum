// Background filesystem scan used to build the first indexed-search catalog.
//
// This is intentionally separate from the service shell so we can swap the
// recursive walk for a faster NTFS-native source later without rewriting the
// command or state plumbing.
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;

use crate::domain::indexed_search::IndexedEntryKind;

use super::catalog::{CatalogEntryRecord, IndexedCatalogStore, IndexedCatalogWriter};

const INSERT_BATCH_SIZE: usize = 2048;
const SCAN_CHECKPOINT_INTERVAL: usize = 16_384;
const SCAN_CANCEL_CHECK_INTERVAL: usize = 512;
const SCAN_PROGRESS_LOG_INTERVAL: usize = 25_000;
pub(super) const SCAN_CANCELLED_MESSAGE: &str = "Indexed-search scan cancelled";

pub(super) struct DriveScanSummary {
    pub(super) entries_indexed: usize,
    pub(super) source: DriveScanSource,
}

pub(super) enum DriveScanSource {
    NtfsFastPath,
    RecursiveFallback,
}

// Scans run on background threads, but they still need to exit promptly when
// indexed search is disabled or the app is shutting down. Callers provide the
// cancellation callback so this module stays independent from service state.
pub(super) fn scan_drive_into_catalog(
    catalog: &IndexedCatalogStore,
    drive_path: &str,
    should_cancel: &impl Fn() -> bool,
) -> Result<DriveScanSummary, String> {
    ensure_scan_not_cancelled(should_cancel)?;

    #[cfg(target_os = "windows")]
    {
        eprintln!("[indexed-search] scan: trying NTFS fast path drive={drive_path}");
        match super::windows_ntfs::scan_drive_into_catalog_fast(catalog, drive_path, should_cancel)
        {
            Ok(entries_indexed) => {
                eprintln!(
                    "[indexed-search] scan: NTFS fast path ok drive={} entries={}",
                    drive_path, entries_indexed
                );
                return Ok(DriveScanSummary {
                    entries_indexed,
                    source: DriveScanSource::NtfsFastPath,
                });
            }
            Err(super::windows_ntfs::NtfsFastScanError::Cancelled) => {
                eprintln!("[indexed-search] scan: NTFS fast path cancelled drive={drive_path}");
                return Err(SCAN_CANCELLED_MESSAGE.to_string());
            }
            Err(super::windows_ntfs::NtfsFastScanError::Unavailable(reason)) => {
                eprintln!(
                    "[indexed-search] scan: NTFS fast path unavailable drive={} reason={}",
                    drive_path, reason
                );
            }
            Err(super::windows_ntfs::NtfsFastScanError::Failed(error)) => {
                eprintln!(
                    "Indexed-search NTFS fast scan failed for {}. Falling back to recursive scan: {}",
                    drive_path, error
                );
            }
        }
    }

    eprintln!("[indexed-search] scan: recursive fallback start drive={drive_path}");
    let mut writer = catalog.begin_drive_refresh(drive_path)?;
    let mut stack = vec![PathBuf::from(drive_path)];
    let mut batch = Vec::with_capacity(INSERT_BATCH_SIZE);
    let mut entries_indexed = 0usize;
    let mut entries_since_checkpoint = 0usize;
    let mut entries_since_cancel_check = 0usize;
    let mut entries_seen = 0usize;
    let mut directories_seen = 0usize;
    let mut next_progress_log = SCAN_PROGRESS_LOG_INTERVAL;

    while let Some(directory) = stack.pop() {
        ensure_scan_not_cancelled(should_cancel)?;
        directories_seen = directories_seen.saturating_add(1);

        let read_dir = match fs::read_dir(&directory) {
            Ok(value) => value,
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
                Err(_) => continue,
            };
            let path = entry.path();
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

            if let Some(record) = CatalogEntryRecord::from_path(&path, kind) {
                batch.push(record);
            }

            if batch.len() >= INSERT_BATCH_SIZE {
                flush_scan_batch(
                    &mut writer,
                    &mut batch,
                    &mut entries_indexed,
                    &mut entries_since_checkpoint,
                    should_cancel,
                )?;
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
    ensure_scan_not_cancelled(should_cancel)?;
    writer.finish()?;
    eprintln!(
        "[indexed-search] scan: recursive fallback ok drive={} entries={} seen={} dirs={}",
        drive_path, entries_indexed, entries_seen, directories_seen
    );

    Ok(DriveScanSummary {
        entries_indexed,
        source: DriveScanSource::RecursiveFallback,
    })
}

fn flush_scan_batch(
    writer: &mut IndexedCatalogWriter,
    batch: &mut Vec<CatalogEntryRecord>,
    entries_indexed: &mut usize,
    entries_since_checkpoint: &mut usize,
    should_cancel: &impl Fn() -> bool,
) -> Result<(), String> {
    ensure_scan_not_cancelled(should_cancel)?;
    writer.insert_batch(batch)?;
    *entries_indexed = (*entries_indexed).saturating_add(batch.len());
    *entries_since_checkpoint = (*entries_since_checkpoint).saturating_add(batch.len());

    // Large scans should surface incremental results instead of hiding a whole
    // drive build behind one long transaction.
    if *entries_since_checkpoint >= SCAN_CHECKPOINT_INTERVAL {
        eprintln!(
            "[indexed-search] scan: recursive checkpoint indexed={}",
            *entries_indexed
        );
        ensure_scan_not_cancelled(should_cancel)?;
        writer.checkpoint()?;
        *entries_since_checkpoint = 0;
        thread::yield_now();
        ensure_scan_not_cancelled(should_cancel)?;
    }

    Ok(())
}

pub(super) fn scan_path_into_writer(
    path: &Path,
    writer: &mut IndexedCatalogWriter,
    should_cancel: &impl Fn() -> bool,
) -> Result<usize, String> {
    ensure_scan_not_cancelled(should_cancel)?;

    let mut batch = Vec::with_capacity(INSERT_BATCH_SIZE);
    let entries_indexed =
        scan_path_into_writer_with_batch(path, writer, &mut batch, should_cancel)?;
    if !batch.is_empty() {
        ensure_scan_not_cancelled(should_cancel)?;
        writer.insert_batch(&batch)?;
        return Ok(entries_indexed.saturating_add(batch.len()));
    }
    Ok(entries_indexed)
}

fn scan_path_into_writer_with_batch(
    path: &Path,
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
    let mut stack = vec![(path.to_path_buf(), metadata)];

    while let Some((current_path, metadata)) = stack.pop() {
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

        if let Some(record) = CatalogEntryRecord::from_path(&current_path, kind) {
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
            let child_metadata = match fs::symlink_metadata(&child_path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            stack.push((child_path, child_metadata));
        }
    }

    Ok(entries_indexed)
}

fn ensure_scan_not_cancelled(should_cancel: &impl Fn() -> bool) -> Result<(), String> {
    if should_cancel() {
        return Err(SCAN_CANCELLED_MESSAGE.to_string());
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn can_descend_into(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
}

#[cfg(not(target_os = "windows"))]
fn can_descend_into(_metadata: &fs::Metadata) -> bool {
    true
}
