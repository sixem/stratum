// Same-volume workspaces and no-clobber renames shared by transfers and conversions.
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT_STAGE: AtomicU64 = AtomicU64::new(0);

// Pin both workspace names so another process cannot swap an ancestor while
// a staged file is opened, published, or cleaned up.
pub(crate) struct StageDirectory {
    pub(crate) path: PathBuf,
    #[cfg(windows)]
    handle: fs::File,
}

impl StageDirectory {
    pub(crate) fn beside(target: &Path, label: &str) -> io::Result<Self> {
        let parent = target
            .parent()
            .ok_or_else(|| io::Error::other("Missing destination parent"))?;
        loop {
            let id = NEXT_STAGE.fetch_add(1, Ordering::Relaxed);
            let name = format!(".stratum-{label}-{}-{id}", std::process::id());
            let path = parent.join(name);
            if super::transfer::same_path(&path, target) {
                continue;
            }
            match Self::create(path) {
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                result => return result,
            }
        }
    }

    pub(crate) fn create(path: PathBuf) -> io::Result<Self> {
        fs::create_dir(&path)?;
        #[cfg(windows)]
        let handle = pin_directory(&path)?;
        Ok(Self {
            path,
            #[cfg(windows)]
            handle,
        })
    }
}

impl Drop for StageDirectory {
    fn drop(&mut self) {
        #[cfg(windows)]
        remove_empty_pinned_directory(&self.handle);
        #[cfg(not(windows))]
        let _ = fs::remove_dir(&self.path);
    }
}

#[cfg(windows)]
fn pin_directory(path: &Path) -> io::Result<fs::File> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::{
        DELETE, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    let directory = fs::File::options()
        .access_mode(FILE_READ_ATTRIBUTES | DELETE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let metadata = directory.metadata()?;
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::other(
            "The staging directory changed before it could be opened",
        ));
    }
    Ok(directory)
}

#[cfg(windows)]
fn remove_empty_pinned_directory(directory: &fs::File) {
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileDispositionInfo, SetFileInformationByHandle, FILE_DISPOSITION_INFO,
    };

    let disposition = FILE_DISPOSITION_INFO { DeleteFile: 1 };
    // Windows checks emptiness and deletes this exact directory when its handle closes.
    unsafe {
        SetFileInformationByHandle(
            directory.as_raw_handle() as isize,
            FileDispositionInfo,
            (&disposition as *const FILE_DISPOSITION_INFO).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        );
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn rename_new(source: &Path, destination: &Path) -> io::Result<()> {
    use super::transfer::windows_extended_path;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    let source = windows_extended_path(source).map_err(io::Error::other)?;
    let destination = windows_extended_path(destination).map_err(io::Error::other)?;
    if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn rename_new(source: &Path, destination: &Path) -> io::Result<()> {
    match fs::symlink_metadata(destination) {
        Ok(_) => Err(io::ErrorKind::AlreadyExists.into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::rename(source, destination),
        Err(error) => Err(error),
    }
}
