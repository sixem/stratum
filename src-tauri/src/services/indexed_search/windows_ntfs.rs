// Windows NTFS fast-path scan provider for indexed-search.
//
// This uses FSCTL_ENUM_USN_DATA to enumerate MFT-backed file records without
// recursively walking the live filesystem tree. The goal is to keep the
// Windows-specific complexity contained here while the higher-level scan flow
// stays readable.
use std::collections::{HashMap, HashSet};
use windows_sys::Win32::Foundation::{
    ERROR_ACCESS_DENIED, ERROR_HANDLE_EOF, ERROR_NO_MORE_FILES, HANDLE,
};
use windows_sys::Win32::Storage::FileSystem::{
    GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES,
};
use windows_sys::Win32::System::Ioctl::{FSCTL_ENUM_USN_DATA, MFT_ENUM_DATA_V1, USN_RECORD_V2};
use windows_sys::Win32::System::IO::DeviceIoControl;

use crate::domain::indexed_search::IndexedEntryKind;

use super::{
    catalog::{CatalogEntryRecord, IndexedCatalogStore},
    scan::{
        ensure_scan_not_cancelled, excluded_path, DriveScanCapture, DriveScanSource,
        SCAN_CANCELLED_MESSAGE,
    },
    windows_journal::{describe_journal_error, open_volume, snapshot_for_open_volume, OwnedHandle},
};

const ENUM_BUFFER_SIZE: usize = 1024 * 1024;
const FAST_INSERT_BATCH_SIZE: usize = 4096;
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
    capture: &DriveScanCapture<'_>,
    started_at: u64,
    should_cancel: &impl Fn() -> bool,
    validate_mount: &impl Fn() -> Result<(), String>,
) -> Result<usize, NtfsFastScanError> {
    ensure_fast_scan_not_cancelled(should_cancel)?;

    let (root_file_reference, records) = {
        let volume_handle = open_volume(capture.volume_guid)
            .map_err(|error| NtfsFastScanError::Unavailable(describe_journal_error(error)))?;
        let root_file_reference = {
            let root_handle = OwnedHandle::open(
                capture.volume_guid,
                FILE_READ_ATTRIBUTES,
                FILE_FLAG_BACKUP_SEMANTICS,
            )
            .map_err(|error| {
                NtfsFastScanError::Failed(format!("Cannot open the volume root: {error}"))
            })?;
            query_root_file_reference(root_handle.raw())?
        };

        snapshot_for_open_volume(&volume_handle).map_err(NtfsFastScanError::Unavailable)?;
        let records = enumerate_ntfs_records(volume_handle.raw(), should_cancel)?;
        (root_file_reference, records)
    };

    // Raw NTFS handles have closed by the time the SQLite write starts.
    match write_catalog_records(
        catalog,
        capture,
        root_file_reference,
        records,
        started_at,
        should_cancel,
        validate_mount,
    ) {
        Ok(entries_indexed) => Ok(entries_indexed),
        Err(error) if error == SCAN_CANCELLED_MESSAGE => Err(NtfsFastScanError::Cancelled),
        Err(error) => Err(NtfsFastScanError::Failed(error)),
    }
}

struct NtfsRecord {
    parent_file_reference_number: u64,
    name: String,
    kind: IndexedEntryKind,
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

fn enumerate_ntfs_records(
    volume_handle: HANDLE,
    should_cancel: &impl Fn() -> bool,
) -> Result<HashMap<u64, NtfsRecord>, NtfsFastScanError> {
    let mut input = MFT_ENUM_DATA_V1 {
        StartFileReferenceNumber: 0,
        LowUsn: 0,
        // Ordinary writes can raise a file's last USN during enumeration.
        // Enumerate live and replay namespace changes from the pre-scan cursor.
        HighUsn: i64::MAX,
        MinMajorVersion: REQUESTED_USN_RECORD_MAJOR_VERSION,
        MaxMajorVersion: REQUESTED_USN_RECORD_MAJOR_VERSION,
    };
    let mut output = vec![0u8; ENUM_BUFFER_SIZE];
    let mut records = HashMap::new();
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
        let enumeration_complete = if ok == 0 {
            let error = std::io::Error::last_os_error();
            if is_access_denied(&error) {
                return Err(NtfsFastScanError::Unavailable(
                    "NTFS record enumeration requires elevation or a privileged helper service."
                        .to_string(),
                ));
            }
            if !is_enumeration_complete(&error) {
                return Err(NtfsFastScanError::Failed(format!(
                    "Failed to enumerate NTFS file records: {error}"
                )));
            }
            if bytes_returned == 0 {
                break;
            }
            true
        } else {
            false
        };

        let bytes = output
            .get(..bytes_returned as usize)
            .filter(|bytes| bytes.len() >= std::mem::size_of::<u64>())
            .ok_or_else(|| {
                NtfsFastScanError::Failed("Invalid NTFS enumeration length".to_string())
            })?;
        let next_start_file_reference =
            u64::from_le_bytes(bytes[..8].try_into().expect("usn header slice"));
        if !enumeration_complete && next_start_file_reference <= input.StartFileReferenceNumber {
            return Err(NtfsFastScanError::Failed(
                "NTFS file enumeration did not advance".to_string(),
            ));
        }

        collect_ntfs_records(&bytes[8..], &mut records).map_err(NtfsFastScanError::Failed)?;
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
    mut buffer: &[u8],
    records: &mut HashMap<u64, NtfsRecord>,
) -> Result<(), String> {
    while !buffer.is_empty() {
        if buffer.len() < std::mem::size_of::<USN_RECORD_V2>() {
            return Err("Indexed-search NTFS enumeration returned a truncated record.".to_string());
        }
        let record = unsafe { std::ptr::read_unaligned(buffer.as_ptr().cast::<USN_RECORD_V2>()) };
        let record_length = record.RecordLength as usize;
        if record_length < std::mem::size_of::<USN_RECORD_V2>()
            || record_length % 8 != 0
            || record_length > buffer.len()
        {
            return Err("Indexed-search NTFS enumeration returned a malformed record.".to_string());
        }

        if record.MajorVersion != 2 {
            return Err(format!(
                "Indexed-search NTFS enumeration returned unsupported USN record version {}.",
                record.MajorVersion
            ));
        }

        let name = parse_record_name(&buffer[..record_length], &record)?;
        if !name.is_empty() {
            let kind = if record.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
                IndexedEntryKind::Directory
            } else {
                IndexedEntryKind::File
            };
            records.insert(
                record.FileReferenceNumber,
                NtfsRecord {
                    parent_file_reference_number: record.ParentFileReferenceNumber,
                    name,
                    kind,
                },
            );
        }

        buffer = &buffer[record_length..];
    }

    Ok(())
}

fn parse_record_name(buffer: &[u8], record: &USN_RECORD_V2) -> Result<String, String> {
    let name_offset = record.FileNameOffset as usize;
    let name_length = record.FileNameLength as usize;
    let name_end = name_offset.saturating_add(name_length);
    if name_offset < std::mem::offset_of!(USN_RECORD_V2, FileName)
        || name_end > buffer.len()
        || name_length % 2 != 0
    {
        return Err("Indexed-search NTFS enumeration returned an invalid file name.".to_string());
    }

    let utf16 = buffer[name_offset..name_end]
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]));
    // Decode into the retained string without allocating a temporary UTF-16 buffer.
    let mut name = String::with_capacity(name_length / 2);
    name.extend(char::decode_utf16(utf16).map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER)));
    Ok(name)
}

fn write_catalog_records(
    catalog: &IndexedCatalogStore,
    capture: &DriveScanCapture<'_>,
    root_file_reference: u64,
    records: HashMap<u64, NtfsRecord>,
    started_at: u64,
    should_cancel: &impl Fn() -> bool,
    validate_mount: &impl Fn() -> Result<(), String>,
) -> Result<usize, String> {
    ensure_scan_not_cancelled(should_cancel)?;

    let drive_path = capture.drive_path;
    let mut writer = catalog.begin_drive_refresh(drive_path)?;
    let mut paths = RecordPaths::new(&records, root_file_reference, drive_path);

    let mut batch = Vec::with_capacity(FAST_INSERT_BATCH_SIZE);
    let mut entries_indexed = 0usize;
    let mut records_processed = 0usize;
    let mut records_resolved = 0usize;
    let mut next_progress_log = FAST_WRITE_PROGRESS_LOG_INTERVAL;

    for (&file_reference_number, record) in &records {
        ensure_scan_not_cancelled(should_cancel)?;
        records_processed = records_processed.saturating_add(1);

        let Some(path) = paths.resolve(file_reference_number) else {
            continue;
        };
        if excluded_path(std::path::Path::new(&path), capture.excluded_directory) {
            continue;
        }
        records_resolved = records_resolved.saturating_add(1);

        batch.push(CatalogEntryRecord::new(
            path,
            record.name.trim().to_lowercase(),
            record.kind,
        ));

        if batch.len() >= FAST_INSERT_BATCH_SIZE {
            writer.insert_batch(&batch)?;
            entries_indexed = entries_indexed.saturating_add(batch.len());
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
        ensure_scan_not_cancelled(should_cancel)?;
        writer.insert_batch(&batch)?;
        entries_indexed = entries_indexed.saturating_add(batch.len());
    }

    writer.finish_drive_refresh(
        drive_path,
        DriveScanSource::NtfsFastPath.label(),
        started_at,
        capture.volume_id,
        capture.checkpoint,
        || {
            ensure_scan_not_cancelled(should_cancel)?;
            validate_mount()
        },
    )?;
    eprintln!(
        "[indexed-search] ntfs: write complete drive={} processed={} resolved={} indexed={}",
        drive_path, records_processed, records_resolved, entries_indexed
    );

    Ok(entries_indexed)
}

fn ensure_fast_scan_not_cancelled(
    should_cancel: &impl Fn() -> bool,
) -> Result<(), NtfsFastScanError> {
    if should_cancel() {
        return Err(NtfsFastScanError::Cancelled);
    }

    Ok(())
}

// Reuse the ancestor walk's scratch space across all records in this scan.
struct RecordPaths<'a> {
    records: &'a HashMap<u64, NtfsRecord>,
    directories: HashMap<u64, String>,
    pending: Vec<(u64, &'a NtfsRecord)>,
    seen: HashSet<u64>,
}

impl<'a> RecordPaths<'a> {
    fn new(records: &'a HashMap<u64, NtfsRecord>, root: u64, root_path: &str) -> Self {
        Self {
            records,
            directories: HashMap::from([(root, root_path.to_owned())]),
            pending: Vec::new(),
            seen: HashSet::new(),
        }
    }

    fn resolve(&mut self, mut current: u64) -> Option<String> {
        self.pending.clear();
        self.seen.clear();

        let ancestor_path = loop {
            if let Some(cached) = self.directories.get(&current) {
                break cached;
            }
            if !self.seen.insert(current) {
                return None;
            }

            let record = self.records.get(&current)?;
            self.pending.push((current, record));
            current = record.parent_file_reference_number;
        };

        let additional_len: usize = self
            .pending
            .iter()
            .map(|(_, record)| record.name.len() + 1)
            .sum();
        let mut path = String::with_capacity(ancestor_path.len() + additional_len);
        path.push_str(ancestor_path);

        // Only directory paths can be reused as ancestors of later records.
        for (file_reference_number, record) in self.pending.drain(..).rev() {
            if !path.is_empty() && !path.ends_with('\\') {
                path.push('\\');
            }
            path.push_str(&record.name);
            if matches!(record.kind, IndexedEntryKind::Directory) {
                self.directories.insert(file_reference_number, path.clone());
            }
        }
        Some(path)
    }
}

fn is_access_denied(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32)
}

fn is_enumeration_complete(error: &std::io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(code) if code == ERROR_HANDLE_EOF as i32 || code == ERROR_NO_MORE_FILES as i32
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolving_paths_reuses_ancestors_and_recovers_from_invalid_records() {
        let record = |parent, name: &str, kind| NtfsRecord {
            parent_file_reference_number: parent,
            name: name.into(),
            kind,
        };
        let records = HashMap::from([
            (2, record(1, "Folder", IndexedEntryKind::Directory)),
            (3, record(2, "hello.txt", IndexedEntryKind::File)),
            (4, record(2, "world.txt", IndexedEntryKind::File)),
            (5, record(6, "First", IndexedEntryKind::Directory)),
            (6, record(5, "Second", IndexedEntryKind::Directory)),
            (7, record(8, "Orphan", IndexedEntryKind::Directory)),
        ]);
        let mut paths = RecordPaths::new(&records, 1, "C:\\");

        assert_eq!(paths.resolve(3).as_deref(), Some(r"C:\Folder\hello.txt"));
        assert_eq!(paths.resolve(5), None);
        assert_eq!(paths.resolve(7), None);
        assert_eq!(paths.resolve(4).as_deref(), Some(r"C:\Folder\world.txt"));
        assert_eq!(paths.resolve(2).as_deref(), Some(r"C:\Folder"));
        assert_eq!(paths.directories.len(), 2);
    }
}
