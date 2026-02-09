// Filesystem-centric command handlers.
use crate::domain::filesystem as fs;
use crate::services::watch;
use tauri::Emitter;

#[tauri::command]
pub async fn get_home() -> Option<String> {
    tauri::async_runtime::spawn_blocking(fs::get_home)
        .await
        .unwrap_or(None)
}

#[tauri::command]
pub async fn get_places() -> Vec<fs::Place> {
    tauri::async_runtime::spawn_blocking(fs::get_places)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn list_drives() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(fs::list_drives)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn list_drive_info() -> Vec<fs::DriveInfo> {
    tauri::async_runtime::spawn_blocking(fs::list_drive_info)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn ensure_dir(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fs::ensure_dir(path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn create_folder(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fs::create_folder(path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fs::create_file(path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn list_dir(
    path: String,
    options: Option<fs::ListDirOptions>,
) -> Result<fs::ListDirResult, String> {
    tauri::async_runtime::spawn_blocking(move || fs::list_dir(path, options))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn list_dir_with_parent(
    path: String,
    options: Option<fs::ListDirOptions>,
) -> Result<fs::ListDirWithParentResult, String> {
    tauri::async_runtime::spawn_blocking(move || fs::list_dir_with_parent(path, options))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn stat_entries(paths: Vec<String>) -> Vec<fs::EntryMeta> {
    tauri::async_runtime::spawn_blocking(move || fs::stat_entries(paths))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn parent_dir(path: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || fs::parent_dir(path))
        .await
        .unwrap_or(None)
}

#[tauri::command]
pub async fn copy_entries(
    window: tauri::Window,
    paths: Vec<String>,
    destination: String,
    transfer_id: Option<String>,
) -> Result<fs::CopyReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Only wire progress events when the UI provides a transfer id.
        let transfer_id = transfer_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let mut emitter = transfer_id.map(|id| {
            let window = window.clone();
            move |update: fs::TransferProgressUpdate| {
                let payload = fs::TransferProgress {
                    id: id.clone(),
                    processed: update.processed,
                    total: update.total,
                    current_path: update.current_path,
                    current_bytes: update.current_bytes,
                    current_total_bytes: update.current_total_bytes,
                };
                let _ = window.emit("transfer_progress", payload);
            }
        });
        fs::copy_entries(
            paths,
            destination,
            emitter
                .as_mut()
                .map(|callback| callback as &mut dyn FnMut(fs::TransferProgressUpdate)),
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn transfer_entries(
    window: tauri::Window,
    paths: Vec<String>,
    destination: String,
    options: Option<fs::TransferOptions>,
    transfer_id: Option<String>,
) -> Result<fs::TransferReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Only wire progress events when the UI provides a transfer id.
        let transfer_id = transfer_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let mut emitter = transfer_id.map(|id| {
            let window = window.clone();
            move |update: fs::TransferProgressUpdate| {
                let payload = fs::TransferProgress {
                    id: id.clone(),
                    processed: update.processed,
                    total: update.total,
                    current_path: update.current_path,
                    current_bytes: update.current_bytes,
                    current_total_bytes: update.current_total_bytes,
                };
                let _ = window.emit("transfer_progress", payload);
            }
        });
        fs::transfer_entries(
            paths,
            destination,
            options,
            emitter
                .as_mut()
                .map(|callback| callback as &mut dyn FnMut(fs::TransferProgressUpdate)),
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn delete_entries(paths: Vec<String>) -> Result<fs::DeleteReport, String> {
    tauri::async_runtime::spawn_blocking(move || fs::delete_entries(paths))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn trash_entries(paths: Vec<String>) -> Result<fs::TrashReport, String> {
    tauri::async_runtime::spawn_blocking(move || fs::trash_entries(paths))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn restore_recycle_entries(
    entries: Vec<fs::RecycleEntry>,
) -> Result<fs::RestoreReport, String> {
    tauri::async_runtime::spawn_blocking(move || fs::restore_recycle_entries(entries))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn restore_recycle_paths(
    paths: Vec<String>,
    min_deleted_at: Option<u64>,
) -> Result<fs::RestorePathsReport, String> {
    tauri::async_runtime::spawn_blocking(move || fs::restore_recycle_paths(paths, min_deleted_at))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn rename_entry(path: String, new_name: String) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || fs::rename_entry(path, new_name))
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn start_dir_watch(
  app: tauri::AppHandle,
  path: String,
  state: tauri::State<'_, watch::DirWatchHandle>,
) -> Result<(), String> {
  watch::start_dir_watch(app, path, state)
}

#[tauri::command]
pub fn stop_dir_watch(
  state: tauri::State<'_, watch::DirWatchHandle>,
) -> Result<(), String> {
  watch::stop_dir_watch(state)
}
