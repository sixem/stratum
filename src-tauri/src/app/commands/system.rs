// System-level command handlers (clipboard, shell, drag, open).
use crate::platform::drag;
use crate::services::{clipboard, opener, shells};

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
