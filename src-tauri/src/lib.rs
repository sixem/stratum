use tauri::Manager;

mod fs;
mod drag;
mod opener;
mod thumbs;
mod clipboard;
mod watch;
mod shells;

#[tauri::command]
async fn get_home() -> Option<String> {
    tauri::async_runtime::spawn_blocking(fs::get_home)
        .await
        .unwrap_or(None)
}

#[tauri::command]
async fn get_places() -> Vec<fs::Place> {
    tauri::async_runtime::spawn_blocking(fs::get_places)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn list_drives() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(fs::list_drives)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn list_drive_info() -> Vec<fs::DriveInfo> {
    tauri::async_runtime::spawn_blocking(fs::list_drive_info)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn ensure_dir(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fs::ensure_dir(path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn list_dir(
    path: String,
    options: Option<fs::ListDirOptions>,
) -> Result<fs::ListDirResult, String> {
    tauri::async_runtime::spawn_blocking(move || fs::list_dir(path, options))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn list_dir_with_parent(
    path: String,
    options: Option<fs::ListDirOptions>,
) -> Result<fs::ListDirWithParentResult, String> {
    tauri::async_runtime::spawn_blocking(move || fs::list_dir_with_parent(path, options))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn stat_entries(paths: Vec<String>) -> Vec<fs::EntryMeta> {
    tauri::async_runtime::spawn_blocking(move || fs::stat_entries(paths))
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn parent_dir(path: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || fs::parent_dir(path))
        .await
        .unwrap_or(None)
}

#[tauri::command]
async fn copy_entries(paths: Vec<String>, destination: String) -> Result<fs::CopyReport, String> {
    tauri::async_runtime::spawn_blocking(move || fs::copy_entries(paths, destination))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn transfer_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<fs::TransferOptions>,
) -> Result<fs::TransferReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs::transfer_entries(paths, destination, options)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn set_clipboard_paths(paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clipboard::set_clipboard_paths(paths))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn get_clipboard_paths() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(clipboard::get_clipboard_paths)
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn delete_entries(paths: Vec<String>) -> Result<fs::DeleteReport, String> {
    tauri::async_runtime::spawn_blocking(move || fs::delete_entries(paths))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fs::rename_entry(path, new_name))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn start_drag(window: tauri::Window, paths: Vec<String>) -> Result<drag::DragOutcome, String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let window_for_closure = window.clone();
    window.clone().run_on_main_thread(move || {
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
async fn request_thumbnails(
    requests: Vec<thumbs::ThumbRequest>,
    options: thumbs::ThumbOptions,
    key: String,
    state: tauri::State<'_, thumbs::ThumbnailHandle>,
) -> Result<Vec<thumbs::ThumbHit>, String> {
    let handle = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        thumbs::request_thumbnails(handle.as_ref(), requests, options, key)
    })
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn set_thumb_paused(
    paused: bool,
    state: tauri::State<'_, thumbs::ThumbnailHandle>,
) -> Result<(), String> {
    thumbs::set_paused(state.inner().as_ref(), paused);
    Ok(())
}

#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || opener::open_path(path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn open_path_properties(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || opener::open_path_properties(path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn get_thumb_cache_dir(app: tauri::AppHandle) -> String {
    thumbs::get_cache_dir(&app)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
async fn clear_thumb_cache(app: tauri::AppHandle) -> Result<(), String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || thumbs::clear_cache_dir(&handle))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn get_thumb_cache_size(app: tauri::AppHandle) -> Result<u64, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || thumbs::get_cache_size(&handle))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn get_shell_availability() -> shells::ShellAvailability {
    tauri::async_runtime::spawn_blocking(shells::get_shell_availability)
        .await
        .unwrap_or(shells::ShellAvailability { pwsh: false, wsl: false })
}

#[tauri::command]
async fn open_shell(kind: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || shells::open_shell(kind, path))
        .await
        .map_err(|err| err.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let thumbnails = thumbs::init(app.handle().clone());
            app.manage(thumbnails);
            app.manage(watch::DirWatchHandle::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_home,
            get_places,
            list_drives,
            ensure_dir,
            list_drive_info,
            list_dir,
            list_dir_with_parent,
            stat_entries,
            parent_dir,
            copy_entries,
            transfer_entries,
            set_clipboard_paths,
            get_clipboard_paths,
            delete_entries,
            rename_entry,
            watch::start_dir_watch,
            watch::stop_dir_watch,
            start_drag,
            request_thumbnails,
            set_thumb_paused,
            open_path,
            open_path_properties,
            get_thumb_cache_dir,
            clear_thumb_cache,
            get_thumb_cache_size,
            get_shell_availability,
            open_shell
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
