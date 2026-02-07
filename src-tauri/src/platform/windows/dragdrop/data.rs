// Drop data inspection and virtual file extraction.
use super::staging::{create_drop_dir, ensure_unique_relative_path, sanitize_relative_path};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::Com::{
    IDataObject, FORMATETC, STGMEDIUM, DVASPECT_CONTENT, IStream, TYMED_HGLOBAL, TYMED_ISTREAM,
};
use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::{ReleaseStgMedium, CF_HDROP};
use windows::Win32::UI::Shell::{
    DragQueryFileW, FILEGROUPDESCRIPTORW, HDROP, CFSTR_FILECONTENTS, CFSTR_FILEDESCRIPTORW,
};

const STREAM_BUFFER_SIZE: usize = 64 * 1024;

pub(super) fn supports_drop(data: &IDataObject) -> bool {
    has_format(data, CF_HDROP.0 as u16, TYMED_HGLOBAL.0 as u32)
        || has_format(data, file_descriptor_format(), TYMED_HGLOBAL.0 as u32)
        || super::shell::supports_shell_id_list(data)
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
            return None;
        }

        let mut paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let length = unsafe { DragQueryFileW(hdrop, index, None) };
            if length == 0 {
                continue;
            }
            let mut buffer = vec![0u16; length as usize + 1];
            let written = unsafe { DragQueryFileW(hdrop, index, Some(&mut buffer)) };
            if written == 0 {
                continue;
            }
            let path = String::from_utf16_lossy(&buffer[..written as usize]);
            if !path.trim().is_empty() {
                paths.push(path);
            }
        }

        Some(paths)
    })
    .unwrap_or_default()
}

pub(super) fn materialize_virtual_paths(data: &IDataObject) -> Vec<String> {
    // Virtual drops (like 7-Zip) expose FileGroupDescriptor + FileContents instead of paths.
    let descriptors = read_file_descriptors(data);
    if descriptors.is_empty() {
        return Vec::new();
    }

    let drop_dir = match create_drop_dir() {
        Ok(dir) => dir,
        Err(_) => return Vec::new(),
    };

    let mut used_names = HashSet::new();
    let mut results = Vec::new();

    for (index, descriptor_name) in descriptors.iter().enumerate() {
        let relative = sanitize_relative_path(descriptor_name, index);
        let unique_relative = ensure_unique_relative_path(relative, &mut used_names);
        let full_path = drop_dir.join(&unique_relative);
        if write_virtual_file(data, index as i32, &full_path).is_ok() {
            results.push(full_path.to_string_lossy().to_string());
        }
    }

    results
}

fn read_file_descriptors(data: &IDataObject) -> Vec<String> {
    // Reads the virtual file names provided by the data object.
    let format_etc = FORMATETC {
        cfFormat: file_descriptor_format(),
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };

    with_medium(data, &format_etc, |medium| {
        let hglobal = unsafe { medium.u.hGlobal };
        let ptr = unsafe { GlobalLock(hglobal) } as *const FILEGROUPDESCRIPTORW;
        if ptr.is_null() {
            return None;
        }
        let count = unsafe { (*ptr).cItems } as usize;
        let base = unsafe { (*ptr).fgd.as_ptr() };
        let mut descriptors = Vec::with_capacity(count);
        for index in 0..count {
            let descriptor = unsafe { std::ptr::addr_of!(*base.add(index)).read_unaligned() };
            let file_name = unsafe { std::ptr::addr_of!(descriptor.cFileName).read_unaligned() };
            let name = wide_to_string(&file_name);
            if !name.trim().is_empty() {
                descriptors.push(name);
            }
        }
        unsafe {
            let _ = GlobalUnlock(hglobal);
        }
        Some(descriptors)
    })
    .unwrap_or_default()
}

fn write_virtual_file(data: &IDataObject, index: i32, path: &Path) -> Result<(), String> {
    // Try stream first (common), then HGLOBAL fallback.
    if write_virtual_stream(data, index, path).is_ok() {
        return Ok(());
    }
    write_virtual_hglobal(data, index, path)
}

fn write_virtual_stream(data: &IDataObject, index: i32, path: &Path) -> Result<(), String> {
    let format_etc = FORMATETC {
        cfFormat: file_contents_format(),
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: index,
        tymed: TYMED_ISTREAM.0 as u32,
    };

    with_medium(data, &format_etc, |medium| {
        if medium.tymed != TYMED_ISTREAM.0 as u32 {
            return None;
        }
        let stream = unsafe { &*medium.u.pstm };
        let stream = stream.as_ref()?;
        write_stream_to_file(stream, path).ok()?;
        Some(())
    })
    .ok_or_else(|| "Missing file contents stream".to_string())
}

fn write_virtual_hglobal(data: &IDataObject, index: i32, path: &Path) -> Result<(), String> {
    let format_etc = FORMATETC {
        cfFormat: file_contents_format(),
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: index,
        tymed: TYMED_HGLOBAL.0 as u32,
    };

    with_medium(data, &format_etc, |medium| {
        if medium.tymed != TYMED_HGLOBAL.0 as u32 {
            return None;
        }
        let hglobal = unsafe { medium.u.hGlobal };
        write_hglobal_to_file(hglobal, path).ok()?;
        Some(())
    })
    .ok_or_else(|| "Missing file contents data".to_string())
}

fn write_stream_to_file(stream: &IStream, path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let mut file = File::create(path).map_err(|err| err.to_string())?;
    let mut buffer = vec![0u8; STREAM_BUFFER_SIZE];
    loop {
        let mut read = 0u32;
        unsafe {
            stream
                .Read(
                    buffer.as_mut_ptr() as *mut _,
                    buffer.len() as u32,
                    Some(&mut read),
                )
                .ok()
                .map_err(|err| err.to_string())?;
        }
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read as usize])
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn write_hglobal_to_file(hglobal: HGLOBAL, path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let size = unsafe { GlobalSize(hglobal) };
    if size == 0 {
        return Err("Empty drop data".to_string());
    }

    let ptr = unsafe { GlobalLock(hglobal) } as *const u8;
    if ptr.is_null() {
        return Err("Failed to lock drop data".to_string());
    }

    let result = (|| {
        let slice = unsafe { std::slice::from_raw_parts(ptr, size) };
        let mut file = File::create(path).map_err(|err| err.to_string())?;
        file.write_all(slice).map_err(|err| err.to_string())?;
        Ok(())
    })();

    unsafe {
        let _ = GlobalUnlock(hglobal);
    }

    result
}

fn wide_to_string(wide: &[u16]) -> String {
    let end = wide
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..end])
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

fn with_medium<T, F>(data: &IDataObject, format: &FORMATETC, f: F) -> Option<T>
where
    F: FnOnce(&STGMEDIUM) -> Option<T>,
{
    let mut medium = unsafe { data.GetData(format) }.ok()?;
    let result = f(&medium);
    unsafe {
        ReleaseStgMedium(&mut medium);
    }
    result
}
