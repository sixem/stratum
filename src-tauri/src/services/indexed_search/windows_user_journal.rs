// Read the redacted NTFS change feed through the volume's root directory.
use std::{io, mem, ptr};

use windows_sys::Win32::{
    Foundation::{
        ERROR_ACCESS_DENIED, ERROR_DELETE_PENDING, ERROR_FILE_NOT_FOUND, ERROR_INVALID_PARAMETER,
        ERROR_JOURNAL_DELETE_IN_PROGRESS, ERROR_JOURNAL_ENTRY_DELETED, ERROR_JOURNAL_NOT_ACTIVE,
        ERROR_MORE_DATA, ERROR_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_PRIVILEGE_NOT_HELD, HANDLE,
    },
    Storage::FileSystem::{
        FileIdType, GetFileInformationByHandle, GetFinalPathNameByHandleW, OpenFileById,
        BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_DESCRIPTOR,
        FILE_ID_DESCRIPTOR_0, FILE_LIST_DIRECTORY, FILE_NAME_NORMALIZED, FILE_READ_ATTRIBUTES,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, VOLUME_NAME_NONE,
    },
    System::{
        Ioctl::{FSCTL_READ_UNPRIVILEGED_USN_JOURNAL, READ_USN_JOURNAL_DATA_V1},
        IO::DeviceIoControl,
    },
};

use crate::platform::windows::file_names::plain_component;

use super::{
    catalog::JournalCheckpoint,
    windows_journal::{query_journal, JournalSnapshot, OwnedHandle},
};

#[path = "windows_user_journal_records.rs"]
mod records;

const READ_BUFFER_SIZE: usize = 64 * 1024;
const MAX_READ_BATCHES: usize = 16;
const MAX_PATH_LENGTH: usize = 32_767;
const DIRECTORY_FLAGS: u32 = FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT;

#[derive(Debug)]
pub(super) enum UserJournalChanges {
    Batch(UserJournalBatch),
    NeedsRebuild,
    Cancelled,
}

#[derive(Debug)]
pub(super) struct UserJournalBatch {
    pub(super) previous: JournalCheckpoint,
    pub(super) next: JournalCheckpoint,
    pub(super) has_more: bool,
    pub(super) changes: Vec<UserJournalChange>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct UserJournalChange {
    pub(super) file_id: u64,
    pub(super) parent_file_id: u64,
    pub(super) reason: u32,
    pub(super) is_dir: bool,
}

pub(super) fn snapshot(volume_guid: &str) -> Result<JournalSnapshot, String> {
    let root = open_root(volume_guid).map_err(describe_journal_error)?;
    let snapshot = query_journal(root.raw()).map_err(describe_journal_error)?;
    // A query success alone does not establish that a driver supports the
    // unprivileged read. Check at the tail before scheduling a baseline scan.
    let mut output = [0; 4096];
    let output = read_batch(
        root.raw(),
        snapshot.journal_id,
        snapshot.next_usn,
        &mut output,
    )
    .map_err(describe_journal_error)?;
    let next_usn = records::batch_cursor(output)
        .map_err(|()| "The NTFS change journal returned an invalid read cursor.".to_string())?;
    if next_usn < snapshot.next_usn {
        return Err("The NTFS change journal returned an invalid read cursor.".into());
    }
    Ok(snapshot)
}

pub(super) fn read_changes(
    volume_guid: &str,
    previous: JournalCheckpoint,
    should_cancel: &impl Fn() -> bool,
) -> Result<UserJournalChanges, String> {
    if should_cancel() {
        return Ok(UserJournalChanges::Cancelled);
    }

    let root = open_root(volume_guid).map_err(describe_journal_error)?;
    let snapshot = query_journal(root.raw()).map_err(describe_journal_error)?;
    if !snapshot.can_resume(previous.journal_id, previous.next_usn) {
        return Ok(UserJournalChanges::NeedsRebuild);
    }
    let mut changes = Vec::new();
    let mut cursor = previous.next_usn;
    if cursor < snapshot.next_usn {
        let mut output = vec![0; READ_BUFFER_SIZE];
        for _ in 0..MAX_READ_BATCHES {
            if should_cancel() {
                return Ok(UserJournalChanges::Cancelled);
            }
            let buffer = match read_batch(root.raw(), snapshot.journal_id, cursor, &mut output) {
                Ok(buffer) => buffer,
                Err(error) if history_changed(&error) => {
                    return Ok(UserJournalChanges::NeedsRebuild);
                }
                Err(error) => return Err(describe_journal_error(error)),
            };
            let Ok(next) = records::collect_batch(buffer, cursor, snapshot.next_usn, &mut changes)
            else {
                return Ok(UserJournalChanges::NeedsRebuild);
            };
            cursor = next;
            if cursor == snapshot.next_usn || changes.len() == records::MAX_CHANGE_RECORDS {
                break;
            }
        }
    }
    Ok(UserJournalChanges::Batch(UserJournalBatch {
        previous,
        next: JournalCheckpoint {
            journal_id: snapshot.journal_id,
            next_usn: cursor,
        },
        has_more: cursor < snapshot.next_usn,
        changes,
    }))
}

fn open_root(volume_guid: &str) -> io::Result<OwnedHandle> {
    // Keep the trailing slash to open the root directory. The volume path
    // without that slash addresses the privileged raw device.
    let guid = volume_guid
        .strip_prefix(r"\\?\Volume{")
        .and_then(|path| path.strip_suffix("}\\"))
        .filter(|guid| {
            guid.len() == 36
                && guid.bytes().enumerate().all(|(index, byte)| {
                    if matches!(index, 8 | 13 | 18 | 23) {
                        byte == b'-'
                    } else {
                        byte.is_ascii_hexdigit()
                    }
                })
        });
    if guid.is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid volume root",
        ));
    }
    OwnedHandle::open(
        volume_guid,
        FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
        DIRECTORY_FLAGS,
    )
}

fn read_batch<'a>(
    root: HANDLE,
    journal_id: u64,
    start_usn: i64,
    output: &'a mut [u8],
) -> io::Result<&'a [u8]> {
    let input = READ_USN_JOURNAL_DATA_V1 {
        StartUsn: start_usn,
        ReasonMask: records::RELEVANT_REASONS,
        ReturnOnlyOnClose: 0,
        Timeout: 0,
        BytesToWaitFor: 0,
        UsnJournalID: journal_id,
        MinMajorVersion: records::RECORD_VERSION,
        MaxMajorVersion: records::RECORD_VERSION,
    };
    let mut bytes_returned = 0;
    let ok = unsafe {
        DeviceIoControl(
            root,
            FSCTL_READ_UNPRIVILEGED_USN_JOURNAL,
            ptr::from_ref(&input).cast(),
            mem::size_of_val(&input) as u32,
            output.as_mut_ptr().cast(),
            output.len() as u32,
            &mut bytes_returned,
            ptr::null_mut(),
        )
    };
    if ok == 0 {
        let error = io::Error::last_os_error();
        if win32_code(&error) != ERROR_MORE_DATA {
            return Err(error);
        }
    }
    output.get(..bytes_returned as usize).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid NTFS change journal read length",
        )
    })
}

pub(super) struct DirectoryResolver {
    root: OwnedHandle,
    root_id: u64,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) enum ResolvedDirectory {
    Path(String),
    Missing,
    Inaccessible,
    Excluded,
}

pub(super) fn open_directory_resolver(volume_guid: &str) -> Result<DirectoryResolver, String> {
    let root = open_root(volume_guid).map_err(describe_journal_error)?;
    let info = file_information(&root).map_err(describe_journal_error)?;
    Ok(DirectoryResolver {
        root,
        root_id: file_id(&info),
    })
}

impl DirectoryResolver {
    // The ID lookup requests attributes under the current user's token.
    // The reconciler separately checks the directory's ancestors and list access.
    pub(super) fn resolve(&self, reference: u64) -> Result<ResolvedDirectory, String> {
        if reference == self.root_id {
            return Ok(ResolvedDirectory::Path("\\".into()));
        }
        let id = FILE_ID_DESCRIPTOR {
            dwSize: mem::size_of::<FILE_ID_DESCRIPTOR>() as u32,
            Type: FileIdType,
            Anonymous: FILE_ID_DESCRIPTOR_0 {
                FileId: reference as i64,
            },
        };
        let raw = unsafe {
            OpenFileById(
                self.root.raw(),
                &id,
                FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                ptr::null(),
                DIRECTORY_FLAGS,
            )
        };
        let resolve = || -> io::Result<ResolvedDirectory> {
            let handle = match OwnedHandle::from_raw(raw) {
                // NTFS can report an invalid parameter for a file reference
                // whose directory disappeared after its journal record.
                Err(error) if win32_code(&error) == ERROR_INVALID_PARAMETER => {
                    return Ok(ResolvedDirectory::Missing);
                }
                opened => opened?,
            };
            let info = file_information(&handle)?;
            if file_id(&info) != reference {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Directory ID changed",
                ));
            }
            if info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
                || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            {
                return Ok(ResolvedDirectory::Excluded);
            }
            directory_path(&handle)
        };
        match resolve() {
            Ok(result) => Ok(result),
            Err(error) => match win32_code(&error) {
                ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND | ERROR_NOT_FOUND
                | ERROR_DELETE_PENDING => Ok(ResolvedDirectory::Missing),
                ERROR_ACCESS_DENIED | ERROR_PRIVILEGE_NOT_HELD => {
                    Ok(ResolvedDirectory::Inaccessible)
                }
                _ => Err(format!(
                    "Could not resolve a directory from the NTFS journal: {error}"
                )),
            },
        }
    }
}

fn file_information(handle: &OwnedHandle) -> io::Result<BY_HANDLE_FILE_INFORMATION> {
    let mut info = unsafe { mem::zeroed() };
    if unsafe { GetFileInformationByHandle(handle.raw(), &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(info)
}

fn file_id(info: &BY_HANDLE_FILE_INFORMATION) -> u64 {
    (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow)
}

fn directory_path(handle: &OwnedHandle) -> io::Result<ResolvedDirectory> {
    // The ID is already scoped by the root handle. Ask Windows for the
    // current spelling without introducing a drive letter or mounted alias.
    let read_path = |output: &mut [u16]| unsafe {
        GetFinalPathNameByHandleW(
            handle.raw(),
            output.as_mut_ptr(),
            output.len() as u32,
            FILE_NAME_NORMALIZED | VOLUME_NAME_NONE,
        ) as usize
    };
    let mut output = vec![0; 260];
    let mut length = read_path(&mut output);
    if (output.len()..=MAX_PATH_LENGTH + 1).contains(&length) {
        output.resize(length, 0);
        length = read_path(&mut output);
    }
    if length == 0 {
        return Err(io::Error::last_os_error());
    }
    if length >= output.len() {
        // A concurrent rename may have changed the required buffer length.
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Directory path changed while resolving its ID",
        ));
    }
    let Ok(path) = String::from_utf16(&output[..length]) else {
        return Ok(ResolvedDirectory::Excluded);
    };
    let Some(relative) = path.strip_prefix('\\') else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Expected a volume-relative directory path",
        ));
    };
    if !relative.is_empty() && !relative.split('\\').all(plain_component) {
        return Ok(ResolvedDirectory::Excluded);
    }
    Ok(ResolvedDirectory::Path(path))
}

fn win32_code(error: &io::Error) -> u32 {
    error.raw_os_error().unwrap_or(0) as u32
}

fn history_changed(error: &io::Error) -> bool {
    matches!(
        win32_code(error),
        ERROR_INVALID_PARAMETER
            | ERROR_JOURNAL_ENTRY_DELETED
            | ERROR_JOURNAL_DELETE_IN_PROGRESS
            | ERROR_JOURNAL_NOT_ACTIVE
    )
}

fn describe_journal_error(error: io::Error) -> String {
    match win32_code(&error) {
        ERROR_ACCESS_DENIED | ERROR_PRIVILEGE_NOT_HELD => {
            "Windows denied standard-user access to this drive's NTFS change journal.".into()
        }
        ERROR_JOURNAL_NOT_ACTIVE | ERROR_JOURNAL_DELETE_IN_PROGRESS => {
            "The NTFS change journal is unavailable for this volume.".into()
        }
        _ => format!("Could not read the NTFS change journal: {error}"),
    }
}
