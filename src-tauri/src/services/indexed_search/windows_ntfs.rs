// Windows NTFS fast-path scan provider for indexed-search.
//
// This uses FSCTL_ENUM_USN_DATA to enumerate MFT-backed file records without
// recursively walking the live filesystem tree. The goal is to keep the
// Windows-specific complexity contained here while the higher-level scan flow
// stays readable.
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::thread;
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_HANDLE_EOF, ERROR_JOURNAL_NOT_ACTIVE, ERROR_NO_MORE_FILES, GENERIC_READ,
    GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ACCESS_RIGHTS,
    FILE_ATTRIBUTE_DIRECTORY, FILE_FLAGS_AND_ATTRIBUTES, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::Ioctl::{
    FSCTL_ENUM_USN_DATA, FSCTL_QUERY_USN_JOURNAL, MFT_ENUM_DATA_V1, USN_JOURNAL_DATA_V1,
    USN_RECORD_V2,
};
use windows_sys::Win32::System::IO::DeviceIoControl;

use crate::domain::indexed_search::IndexedEntryKind;

use super::catalog::{CatalogEntryRecord, IndexedCatalogStore};

const ENUM_BUFFER_SIZE: usize = 1024 * 1024;
const FAST_INSERT_BATCH_SIZE: usize = 4096;
const FAST_SCAN_CHECKPOINT_INTERVAL: usize = 16_384;
const FAST_ENUM_PROGRESS_LOG_INTERVAL: usize = 100_000;
const FAST_WRITE_PROGRESS_LOG_INTERVAL: usize = 100_000;
const REQUESTED_USN_RECORD_MAJOR_VERSION: u16 = 2;

pub(super) enum NtfsFastScanError {
    Cancelled,
    Unavailable(String),
    Failed(String),
}

pub(super) fn scan_drive_into_catalog_fast(
    catalog: &IndexedCatalogStore,
    drive_path: &str,
    should_cancel: &impl Fn() -> bool,
) -> Result<usize, NtfsFastScanError> {
    ensure_fast_scan_not_cancelled(should_cancel)?;

    let volume_handle = open_owned_handle(
        &volume_handle_path(drive_path),
        (GENERIC_READ | GENERIC_WRITE) as FILE_ACCESS_RIGHTS,
        0,
    )?;
    let root_handle =
        open_owned_handle(drive_path, FILE_READ_ATTRIBUTES, FILE_FLAG_BACKUP_SEMANTICS)?;

    let root_file_reference = query_root_file_reference(root_handle.raw())?;
    let journal = query_journal_caps(volume_handle.raw(), drive_path)?;
    let records = enumerate_ntfs_records(volume_handle.raw(), &journal, should_cancel)?;

    match write_catalog_records(
        catalog,
        drive_path,
        root_file_reference,
        records,
        should_cancel,
    ) {
        Ok(entries_indexed) => Ok(entries_indexed),
        Err(error) if error == super::scan::SCAN_CANCELLED_MESSAGE => {
            Err(NtfsFastScanError::Cancelled)
        }
        Err(error) => Err(NtfsFastScanError::Failed(error)),
    }
}

struct NtfsJournalCaps {
    high_usn: i64,
}

struct OwnedHandle(HANDLE);

impl OwnedHandle {
    fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if self.0 != 0 && self.0 != INVALID_HANDLE_VALUE {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[derive(Clone)]
struct NtfsRecord {
    file_reference_number: u64,
    parent_file_reference_number: u64,
    name: String,
    kind: IndexedEntryKind,
}

fn open_owned_handle(
    path: &str,
    desired_access: FILE_ACCESS_RIGHTS,
    flags: FILE_FLAGS_AND_ATTRIBUTES,
) -> Result<OwnedHandle, NtfsFastScanError> {
    let wide_path = wide(path);
    let handle = unsafe {
        CreateFileW(
            wide_path.as_ptr(),
            desired_access,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            flags,
            0,
        )
    };

    if handle == INVALID_HANDLE_VALUE {
        let error = std::io::Error::last_os_error();
        if is_access_denied(&error) {
            return Err(NtfsFastScanError::Unavailable(format!(
                "NTFS journal access requires elevation or a privileged helper service for {}.",
                path
            )));
        }
        return Err(NtfsFastScanError::Failed(format!(
            "Failed to open {}: {}",
            path, error
        )));
    }

    Ok(OwnedHandle(handle))
}

fn query_root_file_reference(handle: HANDLE) -> Result<u64, NtfsFastScanError> {
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetFileInformationByHandle(handle, &mut info) };
    if ok == 0 {
        return Err(NtfsFastScanError::Failed(format!(
            "Failed to read indexed-search root directory information: {}",
            std::io::Error::last_os_error()
        )));
    }

    Ok(((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64)
}

fn query_journal_caps(
    volume_handle: HANDLE,
    drive_path: &str,
) -> Result<NtfsJournalCaps, NtfsFastScanError> {
    let mut journal_data: USN_JOURNAL_DATA_V1 = unsafe { std::mem::zeroed() };
    let mut bytes_returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            volume_handle,
            FSCTL_QUERY_USN_JOURNAL,
            std::ptr::null(),
            0,
            (&mut journal_data as *mut USN_JOURNAL_DATA_V1).cast(),
            std::mem::size_of::<USN_JOURNAL_DATA_V1>() as u32,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        let error = std::io::Error::last_os_error();
        if is_access_denied(&error) {
            return Err(NtfsFastScanError::Unavailable(
                "NTFS journal access requires elevation or a privileged helper service."
                    .to_string(),
            ));
        }
        if is_journal_unavailable(&error) {
            return Err(NtfsFastScanError::Unavailable(format!(
                "The NTFS change journal is not active or not available for {}.",
                drive_path
            )));
        }
        return Err(NtfsFastScanError::Failed(format!(
            "Failed to query the NTFS journal: {}",
            error
        )));
    }

    if !supports_requested_record_version(&journal_data) {
        return Err(NtfsFastScanError::Unavailable(format!(
            "The NTFS journal for {} does not support USN record version {}.",
            drive_path, REQUESTED_USN_RECORD_MAJOR_VERSION
        )));
    }

    Ok(NtfsJournalCaps {
        high_usn: journal_data.NextUsn,
    })
}

fn enumerate_ntfs_records(
    volume_handle: HANDLE,
    journal: &NtfsJournalCaps,
    should_cancel: &impl Fn() -> bool,
) -> Result<HashMap<u64, NtfsRecord>, NtfsFastScanError> {
    let mut input = MFT_ENUM_DATA_V1 {
        StartFileReferenceNumber: 0,
        LowUsn: 0,
        HighUsn: journal.high_usn,
        MinMajorVersion: REQUESTED_USN_RECORD_MAJOR_VERSION,
        MaxMajorVersion: REQUESTED_USN_RECORD_MAJOR_VERSION,
    };
    let mut output = vec![0u8; ENUM_BUFFER_SIZE];
    let mut records = HashMap::new();
    let mut last_start_file_reference = u64::MAX;
    let mut enum_batches = 0usize;
    let mut next_progress_log = FAST_ENUM_PROGRESS_LOG_INTERVAL;

    loop {
        ensure_fast_scan_not_cancelled(should_cancel)?;

        let mut bytes_returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                volume_handle,
                FSCTL_ENUM_USN_DATA,
                (&mut input as *mut MFT_ENUM_DATA_V1).cast(),
                std::mem::size_of::<MFT_ENUM_DATA_V1>() as u32,
                output.as_mut_ptr().cast(),
                output.len() as u32,
                &mut bytes_returned,
                std::ptr::null_mut(),
            )
        };
        let enumeration_complete =
            ok == 0 && is_enumeration_complete(&std::io::Error::last_os_error());

        if ok == 0 {
            let error = std::io::Error::last_os_error();
            if is_access_denied(&error) {
                return Err(NtfsFastScanError::Unavailable(
                    "NTFS record enumeration requires elevation or a privileged helper service."
                        .to_string(),
                ));
            }
            if enumeration_complete {
                if bytes_returned < std::mem::size_of::<u64>() as u32 {
                    break;
                }
            } else {
                return Err(NtfsFastScanError::Failed(format!(
                    "Failed to enumerate NTFS file records: {error}"
                )));
            }
        }

        if bytes_returned < std::mem::size_of::<u64>() as u32 {
            break;
        }

        let bytes_returned = bytes_returned as usize;
        let next_start_file_reference =
            u64::from_ne_bytes(output[..8].try_into().expect("usn header slice"));
        if next_start_file_reference == input.StartFileReferenceNumber
            || next_start_file_reference == last_start_file_reference
        {
            break;
        }

        collect_ntfs_records(&output[..bytes_returned], &mut records)
            .map_err(NtfsFastScanError::Failed)?;
        enum_batches = enum_batches.saturating_add(1);
        if records.len() >= next_progress_log {
            eprintln!(
                "[indexed-search] ntfs: enumerate progress records={} batches={} next_file_ref={}",
                records.len(),
                enum_batches,
                next_start_file_reference
            );
            next_progress_log = next_progress_log.saturating_add(FAST_ENUM_PROGRESS_LOG_INTERVAL);
        }
        ensure_fast_scan_not_cancelled(should_cancel)?;
        last_start_file_reference = input.StartFileReferenceNumber;
        input.StartFileReferenceNumber = next_start_file_reference;

        if enumeration_complete {
            break;
        }
    }

    eprintln!(
        "[indexed-search] ntfs: enumerate complete records={} batches={}",
        records.len(),
        enum_batches
    );
    Ok(records)
}

fn collect_ntfs_records(
    buffer: &[u8],
    records: &mut HashMap<u64, NtfsRecord>,
) -> Result<(), String> {
    let mut offset = std::mem::size_of::<u64>();
    while offset + std::mem::size_of::<USN_RECORD_V2>() <= buffer.len() {
        let record = unsafe {
            std::ptr::read_unaligned(buffer.as_ptr().add(offset).cast::<USN_RECORD_V2>())
        };
        let record_length = record.RecordLength as usize;
        if record_length == 0 || offset + record_length > buffer.len() {
            return Err("Indexed-search NTFS enumeration returned a malformed record.".to_string());
        }

        if record.MajorVersion != 2 {
            return Err(format!(
                "Indexed-search NTFS enumeration returned unsupported USN record version {}.",
                record.MajorVersion
            ));
        }

        let name = parse_record_name(buffer, offset, &record)?;
        if !name.is_empty() {
            let kind = if record.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
                IndexedEntryKind::Directory
            } else {
                IndexedEntryKind::File
            };
            records.insert(
                record.FileReferenceNumber,
                NtfsRecord {
                    file_reference_number: record.FileReferenceNumber,
                    parent_file_reference_number: record.ParentFileReferenceNumber,
                    name,
                    kind,
                },
            );
        }

        offset += record_length;
    }

    Ok(())
}

fn parse_record_name(
    buffer: &[u8],
    record_offset: usize,
    record: &USN_RECORD_V2,
) -> Result<String, String> {
    let name_offset = record_offset + record.FileNameOffset as usize;
    let name_length = record.FileNameLength as usize;
    let name_end = name_offset.saturating_add(name_length);
    if name_end > buffer.len() || name_length % 2 != 0 {
        return Err("Indexed-search NTFS enumeration returned an invalid file name.".to_string());
    }

    let name_slice = unsafe {
        std::slice::from_raw_parts(
            buffer.as_ptr().add(name_offset).cast::<u16>(),
            name_length / 2,
        )
    };
    Ok(String::from_utf16_lossy(name_slice).trim().to_string())
}

fn write_catalog_records(
    catalog: &IndexedCatalogStore,
    drive_path: &str,
    root_file_reference: u64,
    records: HashMap<u64, NtfsRecord>,
    should_cancel: &impl Fn() -> bool,
) -> Result<usize, String> {
    ensure_catalog_write_not_cancelled(should_cancel)?;

    let mut writer = catalog.begin_drive_refresh(drive_path)?;
    let mut resolved_paths = HashMap::new();
    resolved_paths.insert(root_file_reference, Some(drive_path.to_string()));

    let mut batch = Vec::with_capacity(FAST_INSERT_BATCH_SIZE);
    let mut entries_indexed = 0usize;
    let mut entries_since_checkpoint = 0usize;
    let mut records_processed = 0usize;
    let mut records_resolved = 0usize;
    let mut next_progress_log = FAST_WRITE_PROGRESS_LOG_INTERVAL;

    for file_reference_number in records.keys().copied() {
        ensure_catalog_write_not_cancelled(should_cancel)?;
        records_processed = records_processed.saturating_add(1);

        let Some(path) = resolve_record_path(
            file_reference_number,
            root_file_reference,
            drive_path,
            &records,
            &mut resolved_paths,
        ) else {
            continue;
        };
        let Some(record) = records.get(&file_reference_number) else {
            continue;
        };
        records_resolved = records_resolved.saturating_add(1);

        batch.push(CatalogEntryRecord::new(
            path,
            record.name.to_lowercase(),
            record.kind,
        ));

        if batch.len() >= FAST_INSERT_BATCH_SIZE {
            flush_fast_scan_batch(
                &mut writer,
                &mut batch,
                &mut entries_indexed,
                &mut entries_since_checkpoint,
                should_cancel,
            )?;
            batch.clear();
        }

        if records_processed >= next_progress_log {
            eprintln!(
                "[indexed-search] ntfs: write progress drive={} processed={} resolved={} indexed={} total_records={}",
                drive_path,
                records_processed,
                records_resolved,
                entries_indexed.saturating_add(batch.len()),
                records.len()
            );
            next_progress_log = next_progress_log.saturating_add(FAST_WRITE_PROGRESS_LOG_INTERVAL);
        }
    }

    if !batch.is_empty() {
        ensure_catalog_write_not_cancelled(should_cancel)?;
        writer.insert_batch(&batch)?;
        entries_indexed = entries_indexed.saturating_add(batch.len());
    }

    writer.finish()?;
    eprintln!(
        "[indexed-search] ntfs: write complete drive={} processed={} resolved={} indexed={}",
        drive_path, records_processed, records_resolved, entries_indexed
    );

    Ok(entries_indexed)
}

fn flush_fast_scan_batch(
    writer: &mut super::catalog::IndexedCatalogWriter,
    batch: &mut Vec<CatalogEntryRecord>,
    entries_indexed: &mut usize,
    entries_since_checkpoint: &mut usize,
    should_cancel: &impl Fn() -> bool,
) -> Result<(), String> {
    ensure_catalog_write_not_cancelled(should_cancel)?;
    writer.insert_batch(batch)?;
    *entries_indexed = (*entries_indexed).saturating_add(batch.len());
    *entries_since_checkpoint = (*entries_since_checkpoint).saturating_add(batch.len());

    // Keep the fast path fast, but still make partial results visible while a
    // large drive is being indexed.
    if *entries_since_checkpoint >= FAST_SCAN_CHECKPOINT_INTERVAL {
        eprintln!(
            "[indexed-search] ntfs: write checkpoint indexed={}",
            *entries_indexed
        );
        ensure_catalog_write_not_cancelled(should_cancel)?;
        writer.checkpoint()?;
        *entries_since_checkpoint = 0;
        thread::yield_now();
        ensure_catalog_write_not_cancelled(should_cancel)?;
    }

    Ok(())
}

fn ensure_fast_scan_not_cancelled(
    should_cancel: &impl Fn() -> bool,
) -> Result<(), NtfsFastScanError> {
    if should_cancel() {
        return Err(NtfsFastScanError::Cancelled);
    }

    Ok(())
}

fn ensure_catalog_write_not_cancelled(should_cancel: &impl Fn() -> bool) -> Result<(), String> {
    if should_cancel() {
        return Err(super::scan::SCAN_CANCELLED_MESSAGE.to_string());
    }

    Ok(())
}

fn resolve_record_path(
    file_reference_number: u64,
    root_file_reference: u64,
    drive_path: &str,
    records: &HashMap<u64, NtfsRecord>,
    resolved_paths: &mut HashMap<u64, Option<String>>,
) -> Option<String> {
    if let Some(cached) = resolved_paths.get(&file_reference_number) {
        return cached.clone();
    }

    let mut pending: Vec<(u64, String)> = Vec::new();
    let mut seen = HashSet::new();
    let mut current = file_reference_number;

    loop {
        if !seen.insert(current) {
            return None;
        }

        if let Some(cached) = resolved_paths.get(&current) {
            let mut path = cached.clone()?;
            while let Some((child_reference, child_name)) = pending.pop() {
                path = join_parent_child(&path, &child_name);
                resolved_paths.insert(child_reference, Some(path.clone()));
            }
            return resolved_paths
                .get(&file_reference_number)
                .cloned()
                .flatten();
        }

        let record = records.get(&current)?;
        pending.push((record.file_reference_number, record.name.clone()));
        if record.parent_file_reference_number == root_file_reference {
            let mut path = drive_path.to_string();
            while let Some((child_reference, child_name)) = pending.pop() {
                path = join_parent_child(&path, &child_name);
                resolved_paths.insert(child_reference, Some(path.clone()));
            }
            return resolved_paths
                .get(&file_reference_number)
                .cloned()
                .flatten();
        }

        current = record.parent_file_reference_number;
    }
}

fn join_parent_child(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        return name.to_string();
    }
    if parent.ends_with('\\') {
        format!("{parent}{name}")
    } else {
        format!("{parent}\\{name}")
    }
}

fn volume_handle_path(drive_path: &str) -> String {
    let trimmed = drive_path.trim().trim_end_matches(['\\', '/']);
    format!(r"\\.\{trimmed}")
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn supports_requested_record_version(journal: &USN_JOURNAL_DATA_V1) -> bool {
    journal.MinSupportedMajorVersion <= REQUESTED_USN_RECORD_MAJOR_VERSION
        && journal.MaxSupportedMajorVersion >= REQUESTED_USN_RECORD_MAJOR_VERSION
}

fn is_access_denied(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(5)
}

fn is_journal_unavailable(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(ERROR_JOURNAL_NOT_ACTIVE as i32)
}

fn is_enumeration_complete(error: &std::io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(code) if code == ERROR_HANDLE_EOF as i32 || code == ERROR_NO_MORE_FILES as i32
    )
}
