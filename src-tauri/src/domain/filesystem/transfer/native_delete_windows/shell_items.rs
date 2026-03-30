// Shell item conversion helpers for delete operations.
// Keeping the shell-item plumbing separate makes the delete coordinator and
// progress sink easier to read.
use std::ffi::OsStr;
use std::iter::once;
use std::os::windows::ffi::OsStrExt;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{
    IShellItem, SHCreateItemFromParsingName, SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_FILESYSPATH,
};

pub(super) fn shell_item_from_path(path: &str) -> Result<IShellItem, String> {
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).collect();
    unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None) }
        .map_err(|err| err.to_string())
}

pub(super) fn read_shell_item_path(item: &IShellItem) -> Option<String> {
    unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }
        .ok()
        .map(read_pwstr_with_free)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            unsafe { item.GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING) }
                .ok()
                .map(read_pwstr_with_free)
                .filter(|value| !value.trim().is_empty())
        })
}

fn read_pwstr_with_free(value: PWSTR) -> String {
    if value.is_null() {
        return String::new();
    }
    let text = unsafe { String::from_utf16_lossy(value.as_wide()) };
    unsafe {
        CoTaskMemFree(Some(value.0 as *const _));
    }
    text
}
