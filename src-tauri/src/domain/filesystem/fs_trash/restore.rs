// Restore the verified item by handle so a path swap cannot change the source.
use super::super::file_identity::rename_pinned_file;
use super::super::fs_recycle_windows::{pin_plain_directory, RecycleEntry};
use std::fs::{self, File};
use std::io;
use std::mem::size_of;
use std::os::windows::io::AsRawHandle;
use std::path::Path;
use windows_sys::Win32::Storage::FileSystem::{
    FileDispositionInfo, SetFileInformationByHandle, FILE_DISPOSITION_INFO,
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

pub(super) fn restore_entry(
    entry: &RecycleEntry,
) -> io::Result<Option<crate::domain::filesystem::transfer::EntryKind>> {
    let destination = Path::new(&entry.original_path);
    let source = entry.open_for_restore()?;
    let kind = source.data.metadata().ok().map(|meta| {
        crate::domain::filesystem::transfer::kind_from_metadata(&entry.data_path, &meta)
    });
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
    Ok(kind)
}
