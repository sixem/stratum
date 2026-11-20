// Restore the verified item by handle so a path swap cannot change the source.
use super::super::fs_recycle_windows::{pin_plain_directory, RecycleEntry};
use super::super::transfer::windows_extended_path;
use std::fs::{self, File};
use std::io;
use std::mem::{offset_of, size_of};
use std::os::windows::io::AsRawHandle;
use std::path::Path;
use windows_sys::Win32::Storage::FileSystem::{
    FileDispositionInfo, FileRenameInfo, SetFileInformationByHandle, FILE_DISPOSITION_INFO,
    FILE_RENAME_INFO,
};

fn prepare_restore_parent(path: &Path) -> io::Result<Vec<File>> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing restore parent."))?;
    let ancestors: Vec<_> = parent.ancestors().collect();
    let mut pinned = Vec::with_capacity(ancestors.len());
    // Walk down from the volume root so creation cannot follow a junction.
    for directory in ancestors.into_iter().rev() {
        let handle = match pin_plain_directory(directory) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                match fs::create_dir(directory) {
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                    result => result?,
                }
                pin_plain_directory(directory)?
            }
            result => result?,
        };
        pinned.push(handle);
    }
    Ok(pinned)
}

fn rename_pinned_file(source: &File, destination: &Path) -> io::Result<()> {
    let name = windows_extended_path(destination).map_err(io::Error::other)?;
    let name_bytes = (name.len() - 1) * size_of::<u16>();
    let file_name_offset = offset_of!(FILE_RENAME_INFO, FileName);
    let size =
        (file_name_offset + name_bytes + size_of::<u16>()).max(size_of::<FILE_RENAME_INFO>());
    // Allocate an aligned, zeroed variable-length FILE_RENAME_INFO. A zero
    // ReplaceIfExists protects an unrelated existing destination atomically.
    let mut buffer = vec![0usize; size.div_ceil(size_of::<usize>())];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    let result = unsafe {
        (*info).FileNameLength = name_bytes as u32;
        std::ptr::copy_nonoverlapping(
            name.as_ptr(),
            buffer
                .as_mut_ptr()
                .cast::<u8>()
                .add(file_name_offset)
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

pub(super) fn restore_entry(entry: &RecycleEntry) -> io::Result<()> {
    let destination = Path::new(&entry.original_path);
    let source = entry.open_for_restore()?;
    let _directories = prepare_restore_parent(destination)?;
    rename_pinned_file(&source.data, destination)?;

    // Remove only the validated sidecar associated with the restored file.
    let disposition = FILE_DISPOSITION_INFO { DeleteFile: 1 };
    unsafe {
        SetFileInformationByHandle(
            source.info.as_raw_handle() as isize,
            FileDispositionInfo,
            std::ptr::from_ref(&disposition).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        );
    }
    Ok(())
}
