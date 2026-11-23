// System-level command handlers (clipboard, shell, drag, open).
use crate::platform::drag;
use crate::services::{clipboard, opener, shells, transfer_manager};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
#[cfg(target_os = "windows")]
use windows::core::w;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::WIN32_ERROR;
#[cfg(target_os = "windows")]
use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingLaunchPreferences {
    pub indexed_search_enabled: bool,
}

#[tauri::command]
pub fn begin_transfer_shutdown(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    mode: transfer_manager::TransferShutdownMode,
) -> Result<Option<u64>, String> {
    transfer_manager.begin_shutdown(mode)
}

#[tauri::command]
pub async fn wait_for_transfer_shutdown(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    ticket: u64,
) -> Result<bool, String> {
    let manager = transfer_manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.wait_for_shutdown(ticket))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn reopen_transfer_queue(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    ticket: u64,
) -> Result<bool, String> {
    transfer_manager.reopen_queue(ticket)
}

#[tauri::command]
pub async fn set_clipboard_paths(
    window: tauri::Window,
    paths: Vec<String>,
    mode: Option<clipboard::ClipboardMode>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        clipboard::set_clipboard_paths(clipboard_owner(&window)?, paths, mode.unwrap_or_default())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn set_clipboard_text(window: tauri::Window, text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        clipboard::set_clipboard_text(clipboard_owner(&window)?, text)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_clipboard_paths() -> Result<Vec<String>, String> {
    Ok(get_file_clipboard().await?.paths)
}

#[tauri::command]
pub async fn get_file_clipboard() -> Result<clipboard::FileClipboard, String> {
    tauri::async_runtime::spawn_blocking(clipboard::get_file_clipboard)
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn finish_file_cut(
    window: tauri::Window,
    sequence: u32,
    moved: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        clipboard::finish_file_cut(clipboard_owner(&window)?, sequence, moved)
    })
    .await
    .map_err(|err| err.to_string())?
}

fn clipboard_owner(window: &tauri::Window) -> Result<usize, String> {
    #[cfg(windows)]
    {
        window
            .hwnd()
            .map(|hwnd| hwnd.0 as usize)
            .map_err(|err| err.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("File clipboard integration requires Windows.".into())
    }
}

#[tauri::command]
pub async fn start_drag(
    window: tauri::Window,
    paths: Vec<String>,
    id: Option<u64>,
    can_open_folder_tab: Option<bool>,
) -> Result<drag::DragOutcome, String> {
    #[cfg(target_os = "windows")]
    {
        if drag::start_was_canceled(id) {
            return Ok(drag::DragOutcome::None);
        }
        // Shell path resolution may wait on a drive or a network share. The
        // modal OLE gesture itself belongs to the window's STA.
        let single_folder = can_open_folder_tab == Some(true) && paths.len() == 1;
        let prepared = tauri::async_runtime::spawn_blocking(move || drag::prepare_drag(paths))
            .await
            .map_err(|err| err.to_string())?;
        if drag::start_was_canceled(id) {
            return Ok(drag::DragOutcome::None);
        }
        let prepared = prepared?;
        let (tx, mut rx) = tauri::async_runtime::channel(1);
        let source = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = tx.try_send(drag::start_drag(
                    prepared,
                    source.hwnd().ok(),
                    id,
                    single_folder,
                ));
            })
            .map_err(|err| err.to_string())?;
        rx.recv()
            .await
            .unwrap_or_else(|| Err("Drag canceled".into()))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (paths, window, id, can_open_folder_tab);
        Err("Drag is only supported on Windows".into())
    }
}

#[tauri::command]
pub async fn cancel_drag_start(id: u64) {
    #[cfg(target_os = "windows")]
    drag::cancel_drag_start(id);
    #[cfg(not(target_os = "windows"))]
    let _ = id;
}

#[tauri::command]
pub fn file_drop_listener_ready(webview: tauri::Webview) {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        // Native drop targets are registered to the main WebView of a window.
        if webview.label() == webview.window().label() {
            webview
                .state::<crate::platform::windows::dragdrop::IncomingDrops>()
                .subscribe(webview.label());
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = webview;
}

#[tauri::command]
pub async fn release_drop_stage(webview: tauri::Webview, id: u64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        webview
            .state::<crate::platform::windows::dragdrop::IncomingDrops>()
            .release(webview.label(), id);
    })
    .await
    .map_err(|err| err.to_string())?;
    #[cfg(not(target_os = "windows"))]
    let _ = (webview, id);
    Ok(())
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
pub async fn list_open_with_handlers(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<opener::OpenWithHandler>, String> {
    let app_local_data = app.path().app_local_data_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        opener::list_open_with_handlers(path, app_local_data.as_deref())
    })
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
pub async fn get_shell_availability(ffmpeg_path: Option<String>) -> shells::ShellAvailability {
    tauri::async_runtime::spawn_blocking(move || {
        shells::get_shell_availability(ffmpeg_path.as_deref())
    })
    .await
    .unwrap_or(shells::ShellAvailability {
        ffmpeg_message: Some("Could not check FFmpeg on this computer.".into()),
        ..Default::default()
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
