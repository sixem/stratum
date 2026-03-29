// Drive enumeration lives here so Windows-specific API usage stays out of generic listing code.
use super::super::DriveInfo;

#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetLogicalDrives, GetVolumeInformationW,
};

pub fn list_drives() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let mask = unsafe { GetLogicalDrives() };
        if mask == 0 {
            return Vec::new();
        }
        let mut drives = Vec::new();
        for index in 0..26 {
            if (mask >> index) & 1 == 1 {
                let letter = (b'A' + index as u8) as char;
                drives.push(format!("{}:\\", letter));
            }
        }
        drives
    }

    #[cfg(not(target_os = "windows"))]
    {
        vec!["/".to_string()]
    }
}

#[cfg(target_os = "windows")]
fn drive_space(path: &str) -> (Option<u64>, Option<u64>) {
    use std::iter::once;

    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).collect();
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            std::ptr::null_mut(),
            &mut total as *mut u64,
            &mut free as *mut u64,
        )
    };
    if ok == 0 {
        return (None, None);
    }
    (Some(free), Some(total))
}

#[cfg(not(target_os = "windows"))]
fn drive_space(_path: &str) -> (Option<u64>, Option<u64>) {
    (None, None)
}

#[cfg(target_os = "windows")]
fn drive_label(path: &str) -> Option<String> {
    use std::iter::once;

    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).collect();
    let mut name_buffer = [0u16; 256];
    let ok = unsafe {
        GetVolumeInformationW(
            wide.as_ptr(),
            name_buffer.as_mut_ptr(),
            name_buffer.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };
    if ok == 0 {
        return None;
    }
    let len = name_buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(name_buffer.len());
    let label = String::from_utf16_lossy(&name_buffer[..len]);
    let trimmed = label.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn drive_label(_path: &str) -> Option<String> {
    None
}

pub fn list_drive_info() -> Vec<DriveInfo> {
    list_drives()
        .into_iter()
        .map(|path| {
            let (free, total) = drive_space(&path);
            let label = drive_label(&path);
            DriveInfo {
                path,
                free,
                total,
                label,
            }
        })
        .collect()
}
