// Drop data inspection and virtual file extraction.
use super::{stage_slots::StageSlots, staging::ReceivedFiles};
mod virtual_files;
use std::sync::atomic::{AtomicU64, Ordering};

use windows::Win32::System::Com::{
    IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, TYMED_HGLOBAL,
};
use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows::Win32::System::Ole::{ReleaseStgMedium, CF_HDROP};
use windows::Win32::UI::Shell::{DragQueryFileW, CFSTR_FILECONTENTS, CFSTR_FILEDESCRIPTORW, HDROP};
use windows_sys::Win32::Foundation::{
    ERROR_DISK_FULL, ERROR_DISK_QUOTA_EXCEEDED, ERROR_HANDLE_DISK_FULL,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DropDataError {
    InvalidSource,
    UnsupportedShellItems,
    TooManyItems,
    TooDeep,
    InsufficientSpace,
    StagingBusy,
    StagingFailed,
}

impl DropDataError {
    pub(super) fn message(self) -> &'static str {
        match self {
            Self::InvalidSource => "Windows could not read the dropped files from the source application.",
            Self::UnsupportedShellItems => "This source does not provide files or folders Stratum can copy safely. Save the selection to a local folder first.",
            Self::TooManyItems => "This drop contains too many temporary entries. Drop up to 4,096 files and folders at a time.",
            Self::TooDeep => "This drop has a temporary path nested more than 32 levels deep. Save the files to a folder first.",
            Self::InsufficientSpace => "There isn't enough space on the drive that holds the Windows temporary folder. Free some space or save the files directly to the destination.",
            Self::StagingBusy => "Temporary drop storage is busy. Finish or cancel a pending drop and try again.",
            Self::StagingFailed => "Windows could not save the dropped files to temporary storage. Check the available disk space and try again.",
        }
    }

    pub(super) fn from_staging_io(error: std::io::Error) -> Self {
        match error.raw_os_error().map(|code| code as u32) {
            Some(ERROR_DISK_FULL | ERROR_DISK_QUOTA_EXCEEDED | ERROR_HANDLE_DISK_FULL) => {
                Self::InsufficientSpace
            }
            _ => Self::StagingFailed,
        }
    }
}

pub(super) fn supports_virtual_drop(data: &IDataObject) -> bool {
    has_format(data, file_descriptor_format(), TYMED_HGLOBAL.0 as u32)
        || super::shell::supports_shell_id_list(data)
}

pub(super) fn supports_hdrop(data: &IDataObject) -> bool {
    has_format(data, CF_HDROP.0, TYMED_HGLOBAL.0 as u32)
}

fn has_format(data: &IDataObject, format: u16, tymed: u32) -> bool {
    let format_etc = FORMATETC {
        cfFormat: format,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed,
    };
    unsafe { data.QueryGetData(&format_etc).is_ok() }
}

pub(super) fn extract_hdrop_paths(data: &IDataObject) -> Vec<String> {
    let format_etc = FORMATETC {
        cfFormat: CF_HDROP.0 as u16,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };

    with_medium(data, &format_etc, |medium| {
        let hglobal = unsafe { medium.u.hGlobal };
        let hdrop = HDROP(hglobal.0);
        let count = unsafe { DragQueryFileW(hdrop, u32::MAX, None) };
        if count == 0 {
            return Err(DropDataError::InvalidSource);
        }

        let mut paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let length = unsafe { DragQueryFileW(hdrop, index, None) };
            if length == 0 {
                return Err(DropDataError::InvalidSource);
            }
            let mut buffer = vec![0u16; length as usize + 1];
            let written = unsafe { DragQueryFileW(hdrop, index, Some(&mut buffer)) };
            if written != length {
                return Err(DropDataError::InvalidSource);
            }
            let path = String::from_utf16(&buffer[..written as usize])
                .map_err(|_| DropDataError::InvalidSource)?;
            if !std::path::Path::new(&path).is_absolute() {
                return Err(DropDataError::InvalidSource);
            }
            paths.push(path);
        }

        Ok(paths)
    })
    .and_then(Result::ok)
    .unwrap_or_default()
}

pub(super) fn materialize_virtual_paths(
    data: &IDataObject,
    slots: &StageSlots,
) -> Result<Option<ReceivedFiles>, DropDataError> {
    virtual_files::materialize(data, slots)
}

fn file_descriptor_format() -> u16 {
    static FORMAT: AtomicU64 = AtomicU64::new(0);
    let cached = FORMAT.load(Ordering::Relaxed) as u16;
    if cached != 0 {
        return cached;
    }
    let registered = unsafe { RegisterClipboardFormatW(CFSTR_FILEDESCRIPTORW) } as u16;
    FORMAT.store(registered as u64, Ordering::Relaxed);
    registered
}

fn file_contents_format() -> u16 {
    static FORMAT: AtomicU64 = AtomicU64::new(0);
    let cached = FORMAT.load(Ordering::Relaxed) as u16;
    if cached != 0 {
        return cached;
    }
    let registered = unsafe { RegisterClipboardFormatW(CFSTR_FILECONTENTS) } as u16;
    FORMAT.store(registered as u64, Ordering::Relaxed);
    registered
}

// None means the source did not provide this medium. An error after acquisition
// is terminal, so callers cannot accidentally retry malformed data as another format.
fn with_medium<T>(
    data: &IDataObject,
    format: &FORMATETC,
    read: impl FnOnce(&STGMEDIUM) -> Result<T, DropDataError>,
) -> Option<Result<T, DropDataError>> {
    let mut medium = unsafe { data.GetData(format) }.ok()?;
    let result = if medium.tymed == format.tymed {
        read(&medium)
    } else {
        Err(DropDataError::InvalidSource)
    };
    unsafe {
        ReleaseStgMedium(&mut medium);
    }
    Some(result)
}
