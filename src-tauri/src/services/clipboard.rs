// Clipboard integration for file path copy/paste.
pub fn set_clipboard_paths(paths: Vec<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return windows_clipboard::set_clipboard_paths(paths);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = paths;
        return Err("Clipboard file copy is only supported on Windows.".to_string());
    }
}

pub fn get_clipboard_paths() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        // Read file paths from the Windows clipboard (CF_HDROP).
        return windows_clipboard::get_clipboard_paths();
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("Clipboard file copy is only supported on Windows.".to_string());
    }
}

#[cfg(target_os = "windows")]
mod windows_clipboard {
    use std::collections::HashSet;
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr;

    use windows::core::{BOOL, PCWSTR};
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, POINT};
    use windows::Win32::System::DataExchange::{
        CloseClipboard,
        EmptyClipboard,
        GetClipboardData,
        OpenClipboard,
        RegisterClipboardFormatW,
        SetClipboardData,
    };
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };
    use windows::Win32::System::Ole::{CF_HDROP, CF_UNICODETEXT, DROPEFFECT_COPY};
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP, DROPFILES};

    struct ClipboardGuard;

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    pub fn set_clipboard_paths(paths: Vec<String>) -> Result<(), String> {
        let filtered = filter_paths(paths);
        if filtered.is_empty() {
            return Err("No valid paths to copy.".to_string());
        }

        unsafe { OpenClipboard(None).map_err(|err| err.to_string())? };
        let _guard = ClipboardGuard;

        unsafe { EmptyClipboard().map_err(|err| err.to_string())? };

        let drop_handle = write_dropfiles(&filtered)?;
        unsafe {
            if SetClipboardData(CF_HDROP.0 as u32, Some(HANDLE(drop_handle.0))).is_err() {
                let _ = GlobalFree(Some(drop_handle));
                return Err("Failed to set clipboard data.".to_string());
            }
        }

        // Hint to the shell that this is a copy (not a move) operation.
        if let Some(effect_handle) = write_drop_effect(DROPEFFECT_COPY.0) {
            if let Some(format) = preferred_drop_effect_format() {
                unsafe {
                    if SetClipboardData(format, Some(HANDLE(effect_handle.0))).is_err() {
                        let _ = GlobalFree(Some(effect_handle));
                    }
                }
            }
        }

        if let Some(text_handle) = write_unicode_text(&filtered) {
            unsafe {
                if SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(text_handle.0)))
                    .is_err()
                {
                    let _ = GlobalFree(Some(text_handle));
                }
            }
        }

        Ok(())
    }

    pub fn get_clipboard_paths() -> Result<Vec<String>, String> {
        unsafe { OpenClipboard(None).map_err(|err| err.to_string())? };
        let _guard = ClipboardGuard;

        let handle = unsafe { GetClipboardData(CF_HDROP.0 as u32) };
        let handle = match handle {
            Ok(handle) => handle,
            Err(_) => return Ok(Vec::new()),
        };
        let hdrop = HDROP(handle.0 as _);
        let count = unsafe { DragQueryFileW(hdrop, 0xFFFFFFFF, None) };
        if count == 0 {
            return Ok(Vec::new());
        }

        let mut paths = Vec::new();
        for index in 0..count {
            let character_count = unsafe { DragQueryFileW(hdrop, index, None) } as usize;
            if character_count == 0 {
                continue;
            }
            let mut path_buf = vec![0u16; character_count + 1];
            unsafe {
                DragQueryFileW(hdrop, index, Some(&mut path_buf));
            }
            let path = String::from_utf16_lossy(&path_buf[..character_count]);
            if !path.trim().is_empty() {
                paths.push(path);
            }
        }

        Ok(paths)
    }

    fn filter_paths(paths: Vec<String>) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut filtered = Vec::new();
        for path in paths {
            let trimmed = path.trim().to_string();
            if trimmed.is_empty() || !Path::new(&trimmed).exists() {
                continue;
            }
            if seen.insert(trimmed.clone()) {
                filtered.push(trimmed);
            }
        }
        filtered
    }

    fn write_dropfiles(paths: &[String]) -> Result<HGLOBAL, String> {
        let wide_paths = build_drop_list(paths);
        let drop_size = std::mem::size_of::<DROPFILES>();
        let total_bytes = drop_size
            .checked_add(wide_paths.len() * std::mem::size_of::<u16>())
            .ok_or_else(|| "Clipboard data too large.".to_string())?;

        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total_bytes)
                .map_err(|err| err.to_string())?;

            let ptr = GlobalLock(handle) as *mut u8;
            if ptr.is_null() {
                let _ = GlobalFree(Some(handle));
                return Err("Failed to lock clipboard memory.".to_string());
            }

            let drop_ptr = ptr as *mut DROPFILES;
            (*drop_ptr).pFiles = drop_size as u32;
            (*drop_ptr).pt = POINT { x: 0, y: 0 };
            (*drop_ptr).fNC = BOOL(0);
            (*drop_ptr).fWide = BOOL(1);

            let list_ptr = ptr.add(drop_size) as *mut u16;
            ptr::copy_nonoverlapping(wide_paths.as_ptr(), list_ptr, wide_paths.len());

            let _ = GlobalUnlock(handle);
            Ok(handle)
        }
    }

    fn write_unicode_text(paths: &[String]) -> Option<HGLOBAL> {
        let text = paths.join("\r\n");
        let wide: Vec<u16> = OsStr::new(&text).encode_wide().chain(once(0)).collect();
        let total_bytes = wide.len() * std::mem::size_of::<u16>();

        unsafe {
            let handle =
                GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total_bytes).ok()?;

            let ptr = GlobalLock(handle) as *mut u8;
            if ptr.is_null() {
                let _ = GlobalFree(Some(handle));
                return None;
            }

            let list_ptr = ptr as *mut u16;
            ptr::copy_nonoverlapping(wide.as_ptr(), list_ptr, wide.len());
            let _ = GlobalUnlock(handle);
            Some(handle)
        }
    }

    fn preferred_drop_effect_format() -> Option<u32> {
        let wide: Vec<u16> = OsStr::new("Preferred DropEffect")
            .encode_wide()
            .chain(once(0))
            .collect();
        let format = unsafe { RegisterClipboardFormatW(PCWSTR(wide.as_ptr())) };
        if format == 0 {
            None
        } else {
            Some(format)
        }
    }

    fn write_drop_effect(effect: u32) -> Option<HGLOBAL> {
        let total_bytes = std::mem::size_of::<u32>();
        unsafe {
            let handle =
                GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total_bytes).ok()?;
            let ptr = GlobalLock(handle) as *mut u8;
            if ptr.is_null() {
                let _ = GlobalFree(Some(handle));
                return None;
            }
            (ptr as *mut u32).write(effect);
            let _ = GlobalUnlock(handle);
            Some(handle)
        }
    }

    fn build_drop_list(paths: &[String]) -> Vec<u16> {
        let mut wide: Vec<u16> = Vec::new();
        for path in paths {
            wide.extend(OsStr::new(path).encode_wide());
            wide.push(0);
        }
        wide.push(0);
        wide
    }
}
