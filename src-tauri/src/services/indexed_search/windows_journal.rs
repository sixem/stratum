// Read-only access to an NTFS change journal and resolution of changed paths
// on the same volume. The caller owns catalog updates and its durable cursor.
use std::{
    collections::{btree_map::Entry, BTreeMap, HashMap},
    io, mem,
};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER,
        ERROR_JOURNAL_DELETE_IN_PROGRESS, ERROR_JOURNAL_ENTRY_DELETED, ERROR_JOURNAL_NOT_ACTIVE,
        ERROR_MORE_DATA, ERROR_PRIVILEGE_NOT_HELD, HANDLE, INVALID_HANDLE_VALUE,
    },
    Storage::FileSystem::{
        CreateFileW, FileIdType, GetFileInformationByHandle, GetFinalPathNameByHandleW,
        OpenFileById, BY_HANDLE_FILE_INFORMATION, FILE_ACCESS_RIGHTS, FILE_ATTRIBUTE_DIRECTORY,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAGS_AND_ATTRIBUTES, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_DESCRIPTOR, FILE_ID_DESCRIPTOR_0,
        FILE_NAME_NORMALIZED, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING, VOLUME_NAME_NONE,
    },
    System::{
        Ioctl::{
            FSCTL_QUERY_USN_JOURNAL, FSCTL_READ_USN_JOURNAL, READ_USN_JOURNAL_DATA_V1,
            USN_JOURNAL_DATA_V1,
        },
        IO::DeviceIoControl,
    },
};

use super::{
    catalog::JournalCheckpoint,
    journal_batch::{JournalBatch, JournalPathChange},
};

#[path = "windows_journal_records.rs"]
mod records;

const OPEN_SHARE: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
const READ_BUFFER_SIZE: usize = 64 * 1024;
const MAX_READ_BATCHES: usize = 16;
const MAX_PATH_LENGTH: usize = 32_767;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct JournalSnapshot {
    pub(super) journal_id: u64,
    pub(super) first_usn: i64,
    pub(super) next_usn: i64,
}

#[derive(Debug)]
pub(super) enum JournalChanges {
    Batch(JournalBatch),
    NeedsRebuild,
    Cancelled,
}

pub(super) fn snapshot(volume_guid: &str) -> Result<JournalSnapshot, String> {
    let volume = open_volume(volume_guid).map_err(describe_journal_error)?;
    snapshot_for_open_volume(&volume)
}

pub(super) fn snapshot_for_open_volume(volume: &OwnedHandle) -> Result<JournalSnapshot, String> {
    query_journal(volume.raw()).map_err(describe_journal_error)
}

pub(super) fn read_changes(
    drive_root: &str,
    volume_guid: &str,
    previous: JournalCheckpoint,
    should_cancel: &impl Fn() -> bool,
) -> Result<JournalChanges, String> {
    if should_cancel() {
        return Ok(JournalChanges::Cancelled);
    }

    let volume = open_volume(volume_guid).map_err(describe_journal_error)?;
    let snapshot = query_journal(volume.raw()).map_err(describe_journal_error)?;
    if !snapshot.can_resume(previous.journal_id, previous.next_usn) {
        return Ok(JournalChanges::NeedsRebuild);
    }
    if previous.next_usn == snapshot.next_usn {
        return Ok(JournalChanges::Batch(
            snapshot.batch(previous, previous.next_usn),
        ));
    }

    let mut changes = Vec::new();
    let mut output = vec![0; READ_BUFFER_SIZE];
    let mut cursor = previous.next_usn;
    for _ in 0..MAX_READ_BATCHES {
        if should_cancel() {
            return Ok(JournalChanges::Cancelled);
        }
        let buffer = match read_batch(volume.raw(), snapshot.journal_id, cursor, &mut output) {
            Ok(buffer) => buffer,
            Err(error) if journal_history_changed(&error) => {
                return Ok(JournalChanges::NeedsRebuild);
            }
            Err(error) => return Err(describe_journal_error(error)),
        };
        let Ok(next_cursor) =
            records::collect_batch(buffer, cursor, snapshot.next_usn, &mut changes)
        else {
            return Ok(JournalChanges::NeedsRebuild);
        };
        cursor = next_cursor;
        if cursor == snapshot.next_usn || changes.len() == records::MAX_CHANGE_RECORDS {
            break;
        }
    }

    Ok(resolve_changes(
        volume.raw(),
        drive_root,
        snapshot.batch(previous, cursor),
        changes,
        should_cancel,
    ))
}

impl JournalSnapshot {
    fn can_resume(self, journal_id: u64, next_usn: i64) -> bool {
        journal_id == self.journal_id && (self.first_usn..=self.next_usn).contains(&next_usn)
    }

    fn batch(self, previous: JournalCheckpoint, cursor: i64) -> JournalBatch {
        JournalBatch {
            previous,
            next: JournalCheckpoint {
                journal_id: self.journal_id,
                next_usn: cursor,
            },
            has_more: cursor < self.next_usn,
            changes: Vec::new(),
        }
    }
}

#[cfg(not(test))]
pub(super) fn open_volume(_volume_guid: &str) -> io::Result<OwnedHandle> {
    // Volume-wide enumeration can bypass directory ACLs. Keep raw reads out
    // of desktop indexing until a separate reader can enforce the user scope.
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Volume-wide indexing is paused.",
    ))
}

#[cfg(test)]
pub(super) fn open_volume(volume_guid: &str) -> io::Result<OwnedHandle> {
    use windows_sys::Win32::Foundation::GENERIC_READ;
    // A trailing slash opens the volume's root directory, not the volume.
    // Open by GUID so a drive-letter reassignment can't redirect journal reads.
    let device_path = volume_guid.trim_end_matches('\\');
    if !device_path.starts_with(r"\\?\Volume{") || !device_path.ends_with('}') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid volume GUID path",
        ));
    }

    OwnedHandle::open(device_path, GENERIC_READ, 0)
}

fn query_journal(volume: HANDLE) -> io::Result<JournalSnapshot> {
    let mut data: USN_JOURNAL_DATA_V1 = unsafe { mem::zeroed() };
    let mut bytes_returned = 0;
    let succeeded = unsafe {
        DeviceIoControl(
            volume,
            FSCTL_QUERY_USN_JOURNAL,
            std::ptr::null(),
            0,
            std::ptr::from_mut(&mut data).cast(),
            mem::size_of_val(&data) as u32,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };
    if succeeded == 0 {
        return Err(io::Error::last_os_error());
    }

    let first_usn = data.FirstUsn.max(data.LowestValidUsn);
    let version_bytes =
        mem::offset_of!(USN_JOURNAL_DATA_V1, MaxSupportedMajorVersion) + mem::size_of::<u16>();
    if (bytes_returned as usize) < version_bytes
        || first_usn < 0
        || data.NextUsn < first_usn
        || !(data.MinSupportedMajorVersion..=data.MaxSupportedMajorVersion)
            .contains(&records::RECORD_MAJOR_VERSION)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "The NTFS journal returned an unsupported format or cursor range",
        ));
    }

    Ok(JournalSnapshot {
        journal_id: data.UsnJournalID,
        first_usn,
        next_usn: data.NextUsn,
    })
}

fn read_batch<'a>(
    volume: HANDLE,
    journal_id: u64,
    cursor: i64,
    output: &'a mut [u8],
) -> io::Result<&'a [u8]> {
    let input = READ_USN_JOURNAL_DATA_V1 {
        StartUsn: cursor,
        ReasonMask: records::PATH_CHANGE_REASONS,
        ReturnOnlyOnClose: 0,
        Timeout: 0,
        BytesToWaitFor: 0,
        UsnJournalID: journal_id,
        // The decoder uses V2's 64-bit file IDs and field offsets. Windows
        // may return V3 when the request includes the whole supported range.
        MinMajorVersion: records::RECORD_MAJOR_VERSION,
        MaxMajorVersion: records::RECORD_MAJOR_VERSION,
    };
    let mut bytes_returned = 0;
    let succeeded = unsafe {
        DeviceIoControl(
            volume,
            FSCTL_READ_USN_JOURNAL,
            std::ptr::from_ref(&input).cast(),
            mem::size_of_val(&input) as u32,
            output.as_mut_ptr().cast(),
            output.len() as u32,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };
    if succeeded == 0 {
        let error = io::Error::last_os_error();
        if win32_code(&error) != ERROR_MORE_DATA {
            return Err(error);
        }
    }

    output.get(..bytes_returned as usize).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid NTFS journal read length",
        )
    })
}

fn resolve_changes(
    volume: HANDLE,
    drive_root: &str,
    mut batch: JournalBatch,
    changes: Vec<records::NameChange>,
    should_cancel: &impl Fn() -> bool,
) -> JournalChanges {
    let mut parent_paths = HashMap::new();
    let mut paths = Vec::with_capacity(changes.len());
    for change in changes {
        if should_cancel() {
            return JournalChanges::Cancelled;
        }

        let entry = parent_paths.entry(change.parent_file_id);
        let parent = match entry {
            std::collections::hash_map::Entry::Occupied(path) => path.into_mut(),
            std::collections::hash_map::Entry::Vacant(path) => {
                let Some(parent) = resolve_parent(volume, change.parent_file_id) else {
                    return JournalChanges::NeedsRebuild;
                };
                path.insert(parent)
            }
        };
        let Some(path) = records::join_volume_path(drive_root, parent, &change.name) else {
            return JournalChanges::NeedsRebuild;
        };
        paths.push(JournalPathChange {
            path,
            parent_file_id: change.parent_file_id,
            kind: change.kind,
        });
    }

    let mut spellings = BTreeMap::new();
    if paths
        .iter()
        .all(|change| insert_projected_path(&mut spellings, &change.path))
    {
        batch.changes = paths;
        JournalChanges::Batch(batch)
    } else {
        JournalChanges::NeedsRebuild
    }
}

fn insert_projected_path<'a>(paths: &mut BTreeMap<String, &'a str>, path: &'a str) -> bool {
    match paths.entry(path.to_ascii_lowercase()) {
        // Windows can resolve both spellings to the same file while the
        // catalog stores them as distinct paths. Rebuild to keep its actual
        // spelling when a case-only rename reports two equivalent paths.
        Entry::Occupied(existing) => existing.get() == &path,
        Entry::Vacant(slot) => {
            slot.insert(path);
            true
        }
    }
}

fn resolve_parent(volume: HANDLE, file_id: u64) -> Option<String> {
    let id = FILE_ID_DESCRIPTOR {
        dwSize: mem::size_of::<FILE_ID_DESCRIPTOR>() as u32,
        Type: FileIdType,
        Anonymous: FILE_ID_DESCRIPTOR_0 {
            FileId: file_id as i64,
        },
    };
    let raw = unsafe {
        OpenFileById(
            volume,
            &id,
            FILE_READ_ATTRIBUTES,
            OPEN_SHARE,
            std::ptr::null(),
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
        )
    };
    let parent = OwnedHandle::from_raw(raw).ok()?;
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { mem::zeroed() };
    if unsafe { GetFileInformationByHandle(parent.raw(), &mut info) } == 0
        || info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
        || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return None;
    }
    let actual_id = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    if actual_id != file_id {
        return None;
    }

    // This ID was opened on the journal's volume. Using a relative path avoids
    // resolving it through another drive letter or mounted alias.
    let mut output = vec![0; 260];
    let read_path = |output: &mut [u16]| unsafe {
        GetFinalPathNameByHandleW(
            parent.raw(),
            output.as_mut_ptr(),
            output.len() as u32,
            FILE_NAME_NORMALIZED | VOLUME_NAME_NONE,
        ) as usize
    };
    let mut len = read_path(&mut output);
    if (output.len()..=MAX_PATH_LENGTH + 1).contains(&len) {
        output.resize(len, 0);
        len = read_path(&mut output);
    }
    if len == 0 || len >= output.len() {
        return None;
    }
    String::from_utf16(&output[..len]).ok()
}

fn win32_code(error: &io::Error) -> u32 {
    error.raw_os_error().unwrap_or(0) as u32
}

fn journal_history_changed(error: &io::Error) -> bool {
    matches!(
        win32_code(error),
        ERROR_INVALID_PARAMETER
            | ERROR_JOURNAL_ENTRY_DELETED
            | ERROR_JOURNAL_DELETE_IN_PROGRESS
            | ERROR_JOURNAL_NOT_ACTIVE
    )
}

pub(super) fn describe_journal_error(error: io::Error) -> String {
    match win32_code(&error) {
        ERROR_ACCESS_DENIED | ERROR_PRIVILEGE_NOT_HELD => {
            "Reading the NTFS change journal requires administrator access.".to_string()
        }
        ERROR_JOURNAL_NOT_ACTIVE | ERROR_JOURNAL_DELETE_IN_PROGRESS => {
            "The NTFS change journal is unavailable for this volume.".to_string()
        }
        _ => format!("Could not read the NTFS change journal: {error}"),
    }
}

pub(super) struct OwnedHandle(HANDLE);

impl OwnedHandle {
    pub(super) fn open(
        path: &str,
        access: FILE_ACCESS_RIGHTS,
        flags: FILE_FLAGS_AND_ATTRIBUTES,
    ) -> io::Result<Self> {
        let path: Vec<u16> = path.encode_utf16().chain([0]).collect();
        let raw = unsafe {
            CreateFileW(
                path.as_ptr(),
                access,
                OPEN_SHARE,
                std::ptr::null(),
                OPEN_EXISTING,
                flags,
                0,
            )
        };
        Self::from_raw(raw)
    }

    fn from_raw(raw: HANDLE) -> io::Result<Self> {
        if raw == INVALID_HANDLE_VALUE || raw == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(raw))
    }

    pub(super) fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_saved_cursor_must_belong_to_the_retained_journal() {
        let journal = JournalSnapshot {
            journal_id: 42,
            first_usn: 2_048,
            next_usn: 4_096,
        };
        assert!(journal.can_resume(42, 2_048));
        assert!(journal.can_resume(42, 4_096));
        assert!(!journal.can_resume(42, 2_047));
        assert!(!journal.can_resume(42, 4_097));
        assert!(!journal.can_resume(43, 3_000));
    }

    #[test]
    fn rejects_case_only_path_changes_without_rejecting_duplicate_events() {
        let mut paths = BTreeMap::new();
        assert!(insert_projected_path(
            &mut paths,
            r"C:\folder\name.txt".into()
        ));
        assert!(insert_projected_path(
            &mut paths,
            r"C:\folder\name.txt".into()
        ));
        assert!(insert_projected_path(
            &mut paths,
            r"C:\folder\other.txt".into()
        ));
        assert!(!insert_projected_path(
            &mut paths,
            r"C:\Folder\NAME.txt".into()
        ));
        assert_eq!(paths.len(), 2);
    }
}
