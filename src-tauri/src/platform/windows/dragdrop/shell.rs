// Materializes shell namespace drag/drop payloads (e.g. WinSCP) into real temp paths.
//
// Some Windows apps don't provide `CF_HDROP` file paths on drag/drop. Instead they expose a
// "Shell IDList Array" payload (PIDLs) that Explorer understands and can copy out of.
//
// Tauri's webview drag/drop pipeline wants concrete file paths, so we copy the shell items into
// a dedicated temp drop directory and then hand those paths back to the frontend.
use super::staging::create_drop_dir;
use std::ffi::OsStr;
use std::fs;
use std::os::windows::ffi::OsStrExt;

use windows::core::PCWSTR;
use windows::Win32::System::Com::{CoCreateInstance, IDataObject, CLSCTX_ALL};
use windows::Win32::System::Com::{DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL, TYMED_ISTREAM};
use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows::Win32::UI::Shell::{
    FileOperation, IFileOperation, IShellItem, IShellItemArray, SHCreateItemFromParsingName,
    SHCreateShellItemArrayFromDataObject, FOF_NOCONFIRMATION, FOF_NOCONFIRMMKDIR, FOF_NOERRORUI,
};

const CFSTR_SHELLIDLIST: PCWSTR = windows::core::w!("Shell IDList Array");

pub(super) fn supports_shell_id_list(data: &IDataObject) -> bool {
    // Most sources expose this as TYMED_HGLOBAL, but some use an IStream-backed medium.
    // Accept either so we don't show a blocked cursor for legit drops.
    let format = shell_id_list_format();
    has_format(data, format, TYMED_HGLOBAL.0 as u32)
        || has_format(data, format, TYMED_ISTREAM.0 as u32)
}

pub(super) fn materialize_shell_id_list_paths(data: &IDataObject) -> Vec<String> {
    let drop_dir = match create_drop_dir() {
        Ok(dir) => dir,
        Err(_) => return Vec::new(),
    };

    let Some(items) = shell_item_array_from_data_object(data) else {
        return Vec::new();
    };

    let Some(destination_folder) = shell_item_from_path(&drop_dir.to_string_lossy()) else {
        return Vec::new();
    };

    let Some(file_operation) = create_file_operation() else {
        return Vec::new();
    };

    // Keep the operation silent and predictable. We don't want OS dialogs while the app is
    // handling a drop, and the frontend will show its own transfer UI once we have real paths.
    let flags = FOF_NOCONFIRMATION | FOF_NOCONFIRMMKDIR | FOF_NOERRORUI;
    if unsafe { file_operation.SetOperationFlags(flags) }.is_err() {
        return Vec::new();
    }

    if unsafe { file_operation.CopyItems(&items, &destination_folder) }.is_err() {
        return Vec::new();
    }

    if unsafe { file_operation.PerformOperations() }.is_err() {
        return Vec::new();
    }

    // Read the immediate results from the staging directory. We only return top-level entries
    // so the frontend can treat each folder/file as a single dropped item.
    let mut results: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&drop_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            results.push(path.to_string_lossy().to_string());
        }
    }

    results.sort();
    results
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

fn shell_id_list_format() -> u16 {
    // The system assigns a numeric format id at runtime.
    // Cache it via `RegisterClipboardFormatW` so our `QueryGetData` calls are cheap.
    use std::sync::atomic::{AtomicU64, Ordering};
    static FORMAT: AtomicU64 = AtomicU64::new(0);

    let cached = FORMAT.load(Ordering::Relaxed) as u16;
    if cached != 0 {
        return cached;
    }

    let registered = unsafe { RegisterClipboardFormatW(CFSTR_SHELLIDLIST) } as u16;
    FORMAT.store(registered as u64, Ordering::Relaxed);
    registered
}

fn shell_item_array_from_data_object(data: &IDataObject) -> Option<IShellItemArray> {
    // Builds an IShellItemArray from the data object's PIDLs (Shell IDList Array).
    unsafe { SHCreateShellItemArrayFromDataObject(data) }.ok()
}

fn create_file_operation() -> Option<IFileOperation> {
    // Uses IFileOperation so shell extensions (like WinSCP's) can provide content.
    unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_ALL) }.ok()
}

fn shell_item_from_path(path: &str) -> Option<IShellItem> {
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
    let psz = PCWSTR(wide.as_ptr());
    unsafe { SHCreateItemFromParsingName(psz, None) }.ok()
}
