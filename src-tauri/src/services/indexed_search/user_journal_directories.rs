// List only ordinary directories reachable through the user's normal token.
use std::{
    fs::File,
    io,
    mem::{offset_of, size_of},
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    path::Path,
};

use windows_sys::Win32::{
    Foundation::{ERROR_DELETE_PENDING, ERROR_NO_MORE_FILES},
    Storage::FileSystem::{
        FileIdBothDirectoryInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_BOTH_DIR_INFO,
        FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_SHARE_READ,
    },
};

use crate::{
    domain::indexed_search::IndexedEntryKind, platform::windows::file_names::plain_component,
};

use super::super::{scan::can_descend_into, watched_paths::has_exact_name};

const DIRECTORY_BUFFER_SIZE: usize = 64 * 1024;
const DIRECTORY_HEADER_SIZE: usize = offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);

pub(super) struct ScopedDirectory {
    handle: File,
    _ancestors: Vec<File>,
}

pub(super) struct DirectoryEntry {
    pub(super) name: String,
    pub(super) file_id: u64,
    pub(super) kind: IndexedEntryKind,
    pub(super) can_descend: bool,
}

pub(super) fn open_scoped_directory(
    volume_root: &Path,
    relative: &str,
) -> io::Result<Option<ScopedDirectory>> {
    let mut path = volume_root.to_path_buf();
    let Some(mut handle) = open_directory(&path)? else {
        return Ok(None);
    };
    let mut ancestors = Vec::new();
    if !relative.is_empty() {
        for component in relative.split('\\') {
            if !plain_component(component) {
                return Ok(None);
            }
            path.push(component);
            let Some(child) = open_directory(&path)? else {
                return Ok(None);
            };
            // Pin before checking exact spelling so a case-sensitive sibling
            // or replacement junction cannot stand in for this component.
            match has_exact_name(&path) {
                Ok(true) => {}
                Ok(false) => return Ok(None),
                Err(error) if unavailable(&error) => return Ok(None),
                Err(error) => return Err(error),
            }
            ancestors.push(handle);
            handle = child;
        }
    }
    Ok(Some(ScopedDirectory {
        handle,
        _ancestors: ancestors,
    }))
}

fn open_directory(path: &Path) -> io::Result<Option<File>> {
    // Deny write and delete sharing while inspecting a path. Keep ancestors
    // open until the listing ends to prevent directory reparse/rename races.
    let handle = match File::options()
        .access_mode(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
    {
        Ok(handle) => handle,
        Err(error) if unavailable(&error) => return Ok(None),
        Err(error) => return Err(error),
    };
    let meta = handle.metadata()?;
    Ok((meta.is_dir() && can_descend_into(&meta)).then_some(handle))
}

fn unavailable(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied
    ) || error.raw_os_error() == Some(ERROR_DELETE_PENDING as i32)
}

impl ScopedDirectory {
    pub(super) fn file_id(&self) -> io::Result<u64> {
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(self.handle.as_raw_handle() as isize, &mut info) }
            == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok((u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow))
    }

    pub(super) fn entries(
        &self,
        should_cancel: &impl Fn() -> bool,
    ) -> io::Result<Vec<DirectoryEntry>> {
        let mut entries = Vec::new();
        let mut buffer = vec![0u64; DIRECTORY_BUFFER_SIZE / size_of::<u64>()];
        loop {
            if should_cancel() {
                return Err(io::ErrorKind::Interrupted.into());
            }
            let ok = unsafe {
                GetFileInformationByHandleEx(
                    self.handle.as_raw_handle() as isize,
                    FileIdBothDirectoryInfo,
                    buffer.as_mut_ptr().cast(),
                    DIRECTORY_BUFFER_SIZE as u32,
                )
            };
            if ok == 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(ERROR_NO_MORE_FILES as i32) {
                    return Ok(entries);
                }
                return Err(error);
            }
            // The allocation is initialized and sized for the whole buffer.
            // Record offsets below determine which bytes Windows filled.
            let bytes = unsafe {
                std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), DIRECTORY_BUFFER_SIZE)
            };
            read_directory_batch(bytes, &mut entries)?;
        }
    }
}

fn read_directory_batch(mut bytes: &[u8], entries: &mut Vec<DirectoryEntry>) -> io::Result<()> {
    let invalid = || io::Error::new(io::ErrorKind::InvalidData, "Invalid NTFS directory record.");
    loop {
        if bytes.len() < DIRECTORY_HEADER_SIZE {
            return Err(invalid());
        }
        let u32_field = |offset| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        let next = u32_field(offset_of!(FILE_ID_BOTH_DIR_INFO, NextEntryOffset)) as usize;
        let size = if next == 0 { bytes.len() } else { next };
        let length = u32_field(offset_of!(FILE_ID_BOTH_DIR_INFO, FileNameLength)) as usize;
        let end = DIRECTORY_HEADER_SIZE
            .checked_add(length)
            .ok_or_else(invalid)?;
        if length % 2 != 0 || end > size || size > bytes.len() {
            return Err(invalid());
        }
        let utf16 = bytes[DIRECTORY_HEADER_SIZE..end]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        if let Ok(name) = String::from_utf16(&utf16) {
            if plain_component(&name) {
                let attributes = u32_field(offset_of!(FILE_ID_BOTH_DIR_INFO, FileAttributes));
                let id_offset = offset_of!(FILE_ID_BOTH_DIR_INFO, FileId);
                let file_id =
                    u64::from_le_bytes(bytes[id_offset..id_offset + 8].try_into().unwrap());
                let is_dir = attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
                entries.push(DirectoryEntry {
                    name,
                    file_id,
                    kind: if is_dir {
                        IndexedEntryKind::Directory
                    } else {
                        IndexedEntryKind::File
                    },
                    can_descend: is_dir && attributes & FILE_ATTRIBUTE_REPARSE_POINT == 0,
                });
            }
        }
        if next == 0 {
            return Ok(());
        }
        bytes = &bytes[next..];
    }
}
