// Converts Windows console control signals into a normal Tauri exit request.
// This keeps Ctrl+C and similar console shutdown paths from tearing the process
// down before WebView2 and the rest of the app can clean up.
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::thread;

use tauri::{AppHandle, Runtime};
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Console::{
    SetConsoleCtrlHandler, CTRL_BREAK_EVENT, CTRL_CLOSE_EVENT, CTRL_C_EVENT,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject, INFINITE};

static CONSOLE_EXIT_HANDLER_INSTALLED: AtomicBool = AtomicBool::new(false);
static CONSOLE_EXIT_REQUESTED: AtomicBool = AtomicBool::new(false);
static CONSOLE_EXIT_EVENT: AtomicIsize = AtomicIsize::new(0);

pub fn install_console_exit_handler<R: Runtime>(app_handle: &AppHandle<R>) -> Result<(), String> {
    if CONSOLE_EXIT_HANDLER_INSTALLED.swap(true, Ordering::AcqRel) {
        return Ok(());
    }

    let exit_event = unsafe { CreateEventW(None, false, false, PCWSTR::null()) }
        .map_err(|error| error.to_string())?;
    CONSOLE_EXIT_EVENT.store(exit_event.0 as isize, Ordering::Release);

    if let Err(error) = unsafe { SetConsoleCtrlHandler(Some(handle_console_ctrl), true) } {
        CONSOLE_EXIT_EVENT.store(0, Ordering::Release);
        CONSOLE_EXIT_HANDLER_INSTALLED.store(false, Ordering::Release);
        let _ = unsafe { CloseHandle(exit_event) };
        return Err(error.to_string());
    }

    let exit_app = app_handle.clone();
    let exit_event_raw = exit_event.0 as isize;
    let worker = move || wait_for_console_exit(exit_app, exit_event_raw);
    if let Err(error) = thread::Builder::new()
        .name("console-exit-bridge".to_string())
        .spawn(worker)
    {
        let _ = unsafe { SetConsoleCtrlHandler(Some(handle_console_ctrl), false) };
        CONSOLE_EXIT_EVENT.store(0, Ordering::Release);
        CONSOLE_EXIT_HANDLER_INSTALLED.store(false, Ordering::Release);
        let _ = unsafe { CloseHandle(exit_event) };
        return Err(error.to_string());
    }

    Ok(())
}

unsafe extern "system" fn handle_console_ctrl(ctrl_type: u32) -> BOOL {
    match ctrl_type {
        CTRL_C_EVENT | CTRL_BREAK_EVENT | CTRL_CLOSE_EVENT => {
            CONSOLE_EXIT_REQUESTED.store(true, Ordering::Release);
            let raw_handle = CONSOLE_EXIT_EVENT.load(Ordering::Acquire);
            if raw_handle != 0 {
                let _ = unsafe { SetEvent(HANDLE(raw_handle as *mut core::ffi::c_void)) };
            }
            BOOL(1)
        }
        _ => BOOL(0),
    }
}

fn wait_for_console_exit<R: Runtime>(app_handle: AppHandle<R>, exit_event_raw: isize) {
    // The console control handler runs on a system callback thread. It only flips
    // a small amount of shared state and wakes this worker, which then asks Tauri
    // to exit through its normal runtime path.
    let exit_event = HANDLE(exit_event_raw as *mut core::ffi::c_void);
    let wait_result = unsafe { WaitForSingleObject(exit_event, INFINITE) };
    if wait_result != WAIT_OBJECT_0 {
        return;
    }
    if CONSOLE_EXIT_REQUESTED.swap(false, Ordering::AcqRel) {
        app_handle.exit(0);
    }
}
