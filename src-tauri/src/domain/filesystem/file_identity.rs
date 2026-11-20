// Identify an open file even if its directory entry is renamed or replaced.
use std::{fs::File, io};

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
