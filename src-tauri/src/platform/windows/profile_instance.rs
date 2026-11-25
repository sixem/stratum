// Keep one owner of each WebView and SQLite profile. A second launch only
// activates the window associated with the same profile lock file.
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io;
use std::os::windows::fs::OpenOptionsExt;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{plugin, AppHandle, Manager, Wry};
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM};
use windows::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FlashWindowEx, GetPropW, IsIconic, SetForegroundWindow, SetPropW, ShowWindowAsync,
    FLASHWINFO, FLASHW_TRAY, SW_RESTORE,
};

use crate::domain::filesystem::file_identity::file_id;

const LOCK_NAME: &str = "instance.lock";
const WINDOW_WAIT: Duration = Duration::from_secs(3);

struct ProfileInstance {
    _lock: File,
    window_property: Vec<u16>,
}

pub(crate) fn init() -> plugin::TauriPlugin<Wry> {
    // Register before the main window and background services are created.
    plugin::Builder::new("profile-instance")
        .setup(|app, _| {
            let profile = app.path().app_local_data_dir()?;
            fs::create_dir_all(&profile)?;
            let lock = open_lock(&profile)?;
            let (volume, file) = file_id(&lock)?;
            let window_property = format!("StratumProfile:{volume:016x}:{file:032x}")
                .encode_utf16()
                .chain([0])
                .collect::<Vec<_>>();

            let deadline = Instant::now() + WINDOW_WAIT;
            loop {
                match lock.try_lock() {
                    Ok(()) => {
                        app.manage(ProfileInstance {
                            _lock: lock,
                            window_property,
                        });
                        return Ok(());
                    }
                    Err(TryLockError::WouldBlock) => {}
                    Err(TryLockError::Error(error)) => return Err(error.into()),
                }

                if activate_window(&window_property) || Instant::now() >= deadline {
                    // Tauri has no event loop yet. Exiting here avoids opening a
                    // second WebView or starting services on the shared profile.
                    std::process::exit(0);
                }
                thread::sleep(Duration::from_millis(50));
            }
        })
        .build()
}

fn open_lock(profile: &Path) -> io::Result<File> {
    // Deny deletion while open so another process cannot replace the lock file.
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE).0)
        .open(profile.join(LOCK_NAME))
}

pub(crate) fn register_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        let handle = window.hwnd()?;
        let instance = app.state::<ProfileInstance>();
        // The property is a marker tied to the lock file. The value is never dereferenced.
        unsafe {
            SetPropW(
                handle,
                PCWSTR(instance.window_property.as_ptr()),
                Some(HANDLE(std::ptr::dangling_mut())),
            )?;
        }
    }
    Ok(())
}

struct WindowSearch<'a> {
    property: &'a [u16],
    found: Option<HWND>,
}

unsafe extern "system" fn find_profile_window(window: HWND, context: LPARAM) -> BOOL {
    // EnumWindows invokes this callback synchronously while the search lives.
    let search = unsafe { &mut *(context.0 as *mut WindowSearch<'_>) };
    if unsafe { GetPropW(window, PCWSTR(search.property.as_ptr())) }.is_invalid() {
        return BOOL(1);
    }
    search.found = Some(window);
    BOOL(0)
}

fn activate_window(property: &[u16]) -> bool {
    let mut search = WindowSearch {
        property,
        found: None,
    };
    // Returning false from the callback stops enumeration when the window is found.
    let _ = unsafe {
        EnumWindows(
            Some(find_profile_window),
            LPARAM(&mut search as *mut _ as isize),
        )
    };
    let Some(window) = search.found else {
        return false;
    };
    unsafe {
        if IsIconic(window).as_bool() {
            let _ = ShowWindowAsync(window, SW_RESTORE);
        }
        if !SetForegroundWindow(window).as_bool() {
            // Windows can decline foreground activation from a background launch.
            let _ = FlashWindowEx(&FLASHWINFO {
                cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
                hwnd: window,
                dwFlags: FLASHW_TRAY,
                uCount: 3,
                dwTimeout: 0,
            });
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_open_can_take_the_profile_lock_only_after_the_first_owner_exits() {
        let mut nonce = [0; 8];
        getrandom::fill(&mut nonce).unwrap();
        let profile =
            std::env::temp_dir().join(format!("stratum-profile-{:x}", u64::from_le_bytes(nonce)));
        fs::create_dir(&profile).unwrap();
        let first = open_lock(&profile).unwrap();
        first.try_lock().unwrap();
        let second = open_lock(&profile).unwrap();
        assert!(matches!(second.try_lock(), Err(TryLockError::WouldBlock)));
        assert_eq!(file_id(&first).unwrap(), file_id(&second).unwrap());
        assert!(fs::remove_file(profile.join(LOCK_NAME)).is_err());

        drop(first);
        second.try_lock().unwrap();
        drop(second);
        fs::remove_dir_all(profile).unwrap();
    }
}
