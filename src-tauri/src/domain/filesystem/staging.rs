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

    #[cfg(windows)]
    pub(crate) fn open_existing(path: PathBuf) -> io::Result<Self> {
        let handle = pin_directory(&path)?;
        Ok(Self { path, handle })
    }

    #[cfg(windows)]
    pub(crate) fn identity(&self) -> io::Result<String> {
        let (volume, file) = super::file_identity::file_id(&self.handle)?;
        Ok(format!("{volume:016x}:{file:032x}"))
    }

    #[cfg(windows)]
    pub(crate) fn remove_contents(&self) -> io::Result<()> {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        };
        for entry in fs::read_dir(&self.path)? {
            let entry = entry?;
            let metadata = fs::symlink_metadata(entry.path())?;
            let attributes = metadata.file_attributes();
            if attributes & FILE_ATTRIBUTE_DIRECTORY != 0
                && attributes & FILE_ATTRIBUTE_REPARSE_POINT == 0
            {
                fs::remove_dir_all(entry.path())?;
            } else if attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
                fs::remove_dir(entry.path())?;
            } else {
                fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
}

impl Drop for StageDirectory {
    fn drop(&mut self) {
        #[cfg(windows)]
        let _ = remove_empty_pinned_directory(&self.handle);
        #[cfg(not(windows))]
        let _ = fs::remove_dir(&self.path);
    }
}

#[cfg(windows)]
pub(super) fn is_sharing_violation(error: &io::Error) -> bool {
    use windows_sys::Win32::Foundation::{ERROR_LOCK_VIOLATION, ERROR_SHARING_VIOLATION};

    error.raw_os_error().is_some_and(|code| {
        code == ERROR_SHARING_VIOLATION as i32 || code == ERROR_LOCK_VIOLATION as i32
    })
}

#[cfg(windows)]
pub(super) fn retry_after_sharing<T>(
    mut result: io::Result<T>,
    mut operation: impl FnMut() -> io::Result<T>,
) -> io::Result<T> {
    // Give short-lived handles time to close without waiting indefinitely.
    for _ in 0..7 {
        if !result
            .as_ref()
            .is_err_and(|error| is_sharing_violation(error))
        {
            return result;
        }
        std::thread::sleep(std::time::Duration::from_millis(60));
        result = operation();
    }
    result
}

pub(crate) fn retry_sharing<T>(mut operation: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    let result = operation();
    #[cfg(windows)]
    return retry_after_sharing(result, operation);
    #[cfg(not(windows))]
    result
}

#[cfg(windows)]
pub(super) fn pin_directory(path: &Path) -> io::Result<fs::File> {
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
    if !metadata.is_dir() {
        return Err(io::ErrorKind::NotADirectory.into());
    }
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "The directory changed before it could be opened",
        ));
    }
    Ok(directory)
}

#[cfg(windows)]
pub(super) fn remove_empty_pinned_directory(directory: &fs::File) -> io::Result<()> {
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileDispositionInfo, SetFileInformationByHandle, FILE_DISPOSITION_INFO,
    };

    let disposition = FILE_DISPOSITION_INFO { DeleteFile: 1 };
    // Windows checks emptiness and deletes this exact directory when its handle closes.
    let removed = unsafe {
        SetFileInformationByHandle(
            directory.as_raw_handle() as isize,
            FileDispositionInfo,
            (&disposition as *const FILE_DISPOSITION_INFO).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    };
    if removed == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
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
