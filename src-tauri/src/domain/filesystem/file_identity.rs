// Identify an open file even if its directory entry is renamed or replaced.
use serde::{Deserialize, Serialize};
use std::{fs::File, io, path::Path};

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub(super) use windows::rename_pinned_file;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct EntryIdentity(String);

impl EntryIdentity {
    pub(super) fn from_parts((volume, file): (u64, u128)) -> Self {
        Self(format!("{volume:016x}:{file:032x}"))
    }

    pub(super) fn verify(&self, id: (u64, u128)) -> io::Result<()> {
        if *self == Self::from_parts(id) {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "The original item has been replaced. The current item was left in place.",
            ))
        }
    }
}

// Take the identity before a forward rename so an item that arrives at the
// destination after the operation cannot become the target of Undo.
pub(super) struct ObservedEntry {
    id: EntryIdentity,
    #[cfg(windows)]
    _guard: File,
}

impl ObservedEntry {
    pub(super) fn capture(path: &Path) -> Option<Self> {
        #[cfg(windows)]
        {
            let file = windows::open_identity_handle(path, false).ok()?;
            let id = EntryIdentity::from_parts(file_id(&file).ok()?);
            Some(Self { id, _guard: file })
        }
        #[cfg(unix)]
        {
            let id = EntryIdentity::from_parts(unix_path_id(path).ok()?);
            Some(Self { id })
        }
    }

    pub(super) fn published(self, path: &Path) -> Option<EntryIdentity> {
        (Self::capture(path)?.id == self.id).then_some(self.id)
    }

    #[cfg(windows)]
    pub(super) fn identity(&self) -> &EntryIdentity {
        &self.id
    }
}

// Opening, checking, and renaming through one handle protects even a path
// that is replaced after this verification.
pub(super) fn rename_verified(
    source: &Path,
    destination: &Path,
    expected: &EntryIdentity,
) -> io::Result<()> {
    #[cfg(windows)]
    {
        let file = windows::open_identity_handle(source, true)?;
        expected.verify(file_id(&file)?)?;
        rename_pinned_file(&file, destination)
    }
    #[cfg(unix)]
    {
        expected.verify(unix_path_id(source)?)?;
        super::staging::rename_new(source, destination)
    }
}

#[cfg(unix)]
fn unix_path_id(path: &Path) -> io::Result<(u64, u128)> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::symlink_metadata(path)?;
    Ok((meta.dev(), meta.ino().into()))
}

#[cfg(windows)]
pub(crate) fn file_id(file: &File) -> io::Result<(u64, u128)> {
    use std::mem::{size_of, MaybeUninit};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileIdInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        BY_HANDLE_FILE_INFORMATION, FILE_ID_INFO,
    };
    let handle = file.as_raw_handle() as isize;
    let mut id = MaybeUninit::<FILE_ID_INFO>::uninit();
    if unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileIdInfo,
            id.as_mut_ptr().cast(),
            size_of::<FILE_ID_INFO>() as u32,
        )
    } != 0
    {
        let id = unsafe { id.assume_init() };
        let index = u128::from_le_bytes(id.FileId.Identifier);
        if index != 0 {
            return Ok((id.VolumeSerialNumber, index));
        }
    }

    // Some filesystems implement only the older 64-bit file-index query.
    let mut info = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
    if unsafe { GetFileInformationByHandle(handle, info.as_mut_ptr()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let info = unsafe { info.assume_init() };
    let index = (u128::from(info.nFileIndexHigh) << 32) | u128::from(info.nFileIndexLow);
    if index == 0 {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Source does not expose a file ID",
        ));
    }
    Ok((u64::from(info.dwVolumeSerialNumber), index))
}

#[cfg(unix)]
pub(crate) fn file_id(file: &File) -> io::Result<(u64, u128)> {
    use std::os::unix::fs::MetadataExt;
    let meta = file.metadata()?;
    Ok((meta.dev(), meta.ino().into()))
}
