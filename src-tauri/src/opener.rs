#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::iter::once;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use std::time::Duration;

#[cfg(target_os = "windows")]
use windows::core::{BOOL, PCWSTR};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, FALSE, TRUE};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{GetProcessId, WaitForInputIdle};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::{
    ShellExecuteExW, SEE_MASK_FLAG_DDEWAIT, SEE_MASK_FLAG_NO_UI, SEE_MASK_INVOKEIDLIST,
    SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, EnumWindows, GetWindowThreadProcessId, IsWindowVisible,
    SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOWNORMAL,
};

pub fn open_path(path: String) -> Result<(), String> {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return Err("Empty path".to_string());
  }

    #[cfg(target_os = "windows")]
    {
        return open_path_windows(trimmed);
    }

    #[cfg(not(target_os = "windows"))]
    {
        tauri_plugin_opener::open_path(trimmed, None::<&str>)
            .map_err(|err| err.to_string())
    }
}

pub fn open_path_properties(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Empty path".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        return open_properties_windows(trimmed);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Properties view is not supported on this platform.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn open_path_windows(path: &str) -> Result<(), String> {
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).collect();
    let mut info = SHELLEXECUTEINFOW::default();
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_DDEWAIT | SEE_MASK_FLAG_NO_UI;
    info.lpFile = PCWSTR(wide.as_ptr());
    info.nShow = SW_SHOWNORMAL.0;

    unsafe { ShellExecuteExW(&mut info).map_err(|err| err.to_string())? };

    let process = info.hProcess;
    if !process.is_invalid() {
        let pid = unsafe { GetProcessId(process) };
        if pid != 0 {
            let _ = unsafe { AllowSetForegroundWindow(pid) };
            let _ = unsafe { WaitForInputIdle(process, 650) };
            // Best-effort activation so the target app takes focus once.
            for _ in 0..5 {
                if focus_process_window(pid) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(70));
            }
        }
        let _ = unsafe { CloseHandle(process) };
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn open_properties_windows(path: &str) -> Result<(), String> {
    let wide_path: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).collect();
    let verb: Vec<u16> = OsStr::new("properties").encode_wide().chain(once(0)).collect();
    let mut info = SHELLEXECUTEINFOW::default();
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_FLAG_NO_UI | SEE_MASK_INVOKEIDLIST;
    info.lpVerb = PCWSTR(verb.as_ptr());
    info.lpFile = PCWSTR(wide_path.as_ptr());
    info.nShow = SW_SHOWNORMAL.0;

    unsafe { ShellExecuteExW(&mut info).map_err(|err| err.to_string())? };
    Ok(())
}

#[cfg(target_os = "windows")]
fn focus_process_window(process_id: u32) -> bool {
    struct EnumState {
        pid: u32,
        hwnd: HWND,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = &mut *(lparam.0 as *mut EnumState);
        let mut window_pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
        if window_pid == state.pid && IsWindowVisible(hwnd).as_bool() {
            state.hwnd = hwnd;
            return FALSE;
        }
        TRUE
    }

    let mut state = EnumState {
        pid: process_id,
        hwnd: HWND(std::ptr::null_mut()),
    };
    let _ = unsafe { EnumWindows(Some(enum_proc), LPARAM(&mut state as *mut _ as isize)) };
    if state.hwnd.0.is_null() {
        return false;
    }

    unsafe {
        let _ = ShowWindow(state.hwnd, SW_RESTORE);
        let _ = SetForegroundWindow(state.hwnd);
    }
    true
}
