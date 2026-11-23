// Open links themselves and rename only the item described by an open handle.
use std::fs::{File, OpenOptions};
use std::io;
use std::mem::{offset_of, size_of};
use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
use std::path::Path;
use windows_sys::Win32::Storage::FileSystem::{
    FileRenameInfo, SetFileInformationByHandle, DELETE, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_RENAME_INFO, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE,
};

pub(super) fn open_identity_handle(path: &Path, for_rename: bool) -> io::Result<File> {
    let (access, sharing) = if for_rename {
        (DELETE, FILE_SHARE_READ | FILE_SHARE_WRITE)
    } else {
        (0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
    };
    OpenOptions::new()
        .access_mode(access)
        .share_mode(sharing)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

pub(in crate::domain::filesystem) fn rename_pinned_file(
    source: &File,
    destination: &Path,
) -> io::Result<()> {
    let name =
        super::super::transfer::windows_extended_path(destination).map_err(io::Error::other)?;
    let name_bytes = (name.len() - 1) * size_of::<u16>();
    let name_offset = offset_of!(FILE_RENAME_INFO, FileName);
    let size = (name_offset + name_bytes + size_of::<u16>()).max(size_of::<FILE_RENAME_INFO>());
    // A zero ReplaceIfExists protects an unrelated destination atomically.
    let mut buffer = vec![0usize; size.div_ceil(size_of::<usize>())];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    let result = unsafe {
        (*info).FileNameLength = name_bytes as u32;
        std::ptr::copy_nonoverlapping(
            name.as_ptr(),
            buffer
                .as_mut_ptr()
                .cast::<u8>()
                .add(name_offset)
                .cast::<u16>(),
            name.len(),
        );
        SetFileInformationByHandle(
            source.as_raw_handle() as isize,
            FileRenameInfo,
            info.cast(),
            size as u32,
        )
    };
    if result == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
