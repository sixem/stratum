// System-level command handlers (clipboard, shell, drag, open).
use crate::platform::drag;
use crate::services::{clipboard, opener, shells};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::ffi::OsStr;
use std::fs;
#[cfg(target_os = "windows")]
use std::iter::once;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;
use tauri::Manager;
#[cfg(target_os = "windows")]
use windows::core::{w, HRESULT, PCWSTR};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, HANDLE, WIN32_ERROR};
#[cfg(target_os = "windows")]
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
#[cfg(target_os = "windows")]
use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_FLAG_DDEWAIT, SHELLEXECUTEINFOW};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingLaunchPreferences {
    pub indexed_search_enabled: bool,
    pub accelerated_ntfs_indexing: bool,
}

#[tauri::command]
pub async fn set_clipboard_paths(paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clipboard::set_clipboard_paths(paths))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_clipboard_paths() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(clipboard::get_clipboard_paths)
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn start_drag(
    window: tauri::Window,
    paths: Vec<String>,
) -> Result<drag::DragOutcome, String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let window_for_closure = window.clone();
    window
        .clone()
        .run_on_main_thread(move || {
            #[cfg(target_os = "windows")]
            let hwnd = window_for_closure.hwnd().ok();
            #[cfg(not(target_os = "windows"))]
            let hwnd = None;

            let result = drag::start_drag(paths, hwnd);
            let _ = tx.try_send(result);
        })
        .map_err(|err| err.to_string())?;

    rx.recv()
        .await
        .unwrap_or_else(|| Err("Drag canceled".to_string()))
}

#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || opener::open_path(path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn open_path_properties(paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || opener::open_path_properties(paths))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn list_open_with_handlers(path: String) -> Result<Vec<opener::OpenWithHandler>, String> {
    tauri::async_runtime::spawn_blocking(move || opener::list_open_with_handlers(path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn open_path_with_handler(path: String, handler_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || opener::open_path_with_handler(path, handler_id))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn open_path_with_dialog(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || opener::open_path_with_dialog(path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_shell_availability() -> shells::ShellAvailability {
    tauri::async_runtime::spawn_blocking(shells::get_shell_availability)
        .await
        .unwrap_or(shells::ShellAvailability {
            pwsh: false,
            wsl: false,
            ffmpeg: false,
        })
}

#[tauri::command]
pub async fn open_shell(kind: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || shells::open_shell(kind, path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn is_windows_11() -> bool {
    #[cfg(target_os = "windows")]
    {
        return query_windows_build_number().is_some_and(|build| build >= 22000);
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
pub fn get_indexing_runtime_mode() -> String {
    #[cfg(target_os = "windows")]
    {
        if is_process_elevated().unwrap_or(false) {
            return "accelerated".to_string();
        }
    }

    "normal".to_string()
}

#[tauri::command]
pub fn get_indexing_launch_preferences(app: tauri::AppHandle) -> IndexingLaunchPreferences {
    read_indexing_launch_preferences(&app).unwrap_or_default()
}

#[tauri::command]
pub fn set_indexing_launch_preferences(
    app: tauri::AppHandle,
    preferences: IndexingLaunchPreferences,
) -> Result<(), String> {
    write_indexing_launch_preferences(&app, &preferences)
}

#[tauri::command]
pub fn restart_as_administrator(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if tauri::is_dev() {
            return Err(
                "Administrator relaunch is disabled during `tauri dev`. Test accelerated indexing from a built app.".to_string(),
            );
        }

        if is_process_elevated().unwrap_or(false) {
            return Ok(());
        }

        relaunch_current_process_as_administrator()?;
        for window in app.webview_windows().values() {
            let _ = window.hide();
            let _ = window.close();
        }
        app.exit(0);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Administrator relaunch is only supported on Windows.".to_string())
    }
}

pub(crate) fn handle_startup_indexing_launch_gate(app: &tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        if tauri::is_dev() {
            return Ok(true);
        }

        let mut preferences = read_indexing_launch_preferences(app).unwrap_or_default();
        if !(preferences.indexed_search_enabled && preferences.accelerated_ntfs_indexing) {
            return Ok(true);
        }

        if is_process_elevated().unwrap_or(false) {
            return Ok(true);
        }

        match relaunch_current_process_as_administrator() {
            Ok(()) => {
                app.exit(0);
                Ok(false)
            }
            Err(error) => {
                preferences.accelerated_ntfs_indexing = false;
                let _ = write_indexing_launch_preferences(app, &preferences);

                if error != "Administrator approval was canceled." {
                    eprintln!("Accelerated indexing startup relaunch failed: {error}");
                }

                Ok(true)
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(true)
    }
}

#[cfg(target_os = "windows")]
fn query_windows_build_number() -> Option<u32> {
    let mut buffer = [0u16; 32];
    let mut buffer_size = std::mem::size_of_val(&buffer) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"),
            w!("CurrentBuildNumber"),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut buffer_size),
        )
    };
    if status != WIN32_ERROR(0) {
        return None;
    }

    let value_len = (buffer_size as usize / std::mem::size_of::<u16>()).saturating_sub(1);
    String::from_utf16(&buffer[..value_len])
        .ok()?
        .parse::<u32>()
        .ok()
}

#[cfg(target_os = "windows")]
fn is_process_elevated() -> windows::core::Result<bool> {
    let mut token = HANDLE::default();
    unsafe {
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)?;
    }

    let mut elevation = TOKEN_ELEVATION::default();
    let mut return_len = 0u32;
    let query_result = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut return_len,
        )
    };

    unsafe {
        let _ = CloseHandle(token);
    }

    query_result?;
    Ok(elevation.TokenIsElevated != 0)
}

#[cfg(target_os = "windows")]
fn relaunch_current_process_as_administrator() -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|err| format!("Failed to resolve current executable: {err}"))?;
    let working_directory = executable.parent().map(|path| path.as_os_str());
    let launch_arguments = std::env::args_os()
        .skip(1)
        .map(|arg| quote_windows_command_argument(arg.as_os_str()))
        .collect::<Vec<_>>()
        .join(" ");

    let verb = encode_wide(OsStr::new("runas"));
    let executable_wide = encode_wide(executable.as_os_str());
    let parameters_wide = if launch_arguments.is_empty() {
        None
    } else {
        Some(encode_wide(OsStr::new(&launch_arguments)))
    };
    let directory_wide = working_directory.map(encode_wide);

    let mut info = SHELLEXECUTEINFOW::default();
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_FLAG_DDEWAIT;
    info.lpVerb = PCWSTR(verb.as_ptr());
    info.lpFile = PCWSTR(executable_wide.as_ptr());
    if let Some(parameters) = parameters_wide.as_ref() {
        info.lpParameters = PCWSTR(parameters.as_ptr());
    }
    if let Some(directory) = directory_wide.as_ref() {
        info.lpDirectory = PCWSTR(directory.as_ptr());
    }
    info.nShow = SW_SHOWNORMAL.0;

    unsafe { ShellExecuteExW(&mut info) }.map_err(map_elevation_launch_error)
}

fn read_indexing_launch_preferences(
    app: &tauri::AppHandle,
) -> Result<IndexingLaunchPreferences, String> {
    let path = indexing_launch_preferences_path(app)?;
    let raw = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(IndexingLaunchPreferences::default())
        }
        Err(error) => {
            return Err(format!(
                "Failed to read indexing launch preferences {}: {error}",
                path.display()
            ))
        }
    };

    serde_json::from_str::<IndexingLaunchPreferences>(&raw).map_err(|error| {
        format!(
            "Failed to parse indexing launch preferences {}: {error}",
            path.display()
        )
    })
}

fn write_indexing_launch_preferences(
    app: &tauri::AppHandle,
    preferences: &IndexingLaunchPreferences,
) -> Result<(), String> {
    let path = indexing_launch_preferences_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create indexing launch preferences directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let payload = serde_json::to_string_pretty(preferences)
        .map_err(|error| format!("Failed to serialize indexing launch preferences: {error}"))?;
    fs::write(&path, payload).map_err(|error| {
        format!(
            "Failed to write indexing launch preferences {}: {error}",
            path.display()
        )
    })
}

fn indexing_launch_preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("settings").join("indexing-launch.json"))
        .map_err(|error| format!("Failed to resolve the app data directory: {error}"))
}

#[cfg(target_os = "windows")]
fn map_elevation_launch_error(error: windows::core::Error) -> String {
    if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) {
        return "Administrator approval was canceled.".to_string();
    }
    format!("Failed to restart with administrator approval: {error}")
}

#[cfg(target_os = "windows")]
fn encode_wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(once(0)).collect()
}

#[cfg(target_os = "windows")]
fn quote_windows_command_argument(arg: &OsStr) -> String {
    let value = arg.to_string_lossy();
    if !value.contains([' ', '\t', '"']) {
        return value.into_owned();
    }

    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    let mut backslash_count = 0usize;

    for character in value.chars() {
        match character {
            '\\' => {
                backslash_count += 1;
                quoted.push('\\');
            }
            '"' => {
                quoted.push_str(&"\\".repeat(backslash_count));
                backslash_count = 0;
                quoted.push('\\');
                quoted.push('"');
            }
            _ => {
                backslash_count = 0;
                quoted.push(character);
            }
        }
    }

    quoted.push_str(&"\\".repeat(backslash_count));
    quoted.push('"');
    quoted
}
