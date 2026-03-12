// Filesystem-centric command handlers.
use crate::domain::filesystem as fs;
use crate::services::transfer_manager;
use crate::services::watch;

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
pub async fn list_folder_thumb_samples_batch(
    folder_paths: Vec<String>,
    options: Option<fs::FolderThumbSampleBatchOptions>,
) -> Vec<fs::FolderThumbSampleBatchResult> {
    tauri::async_runtime::spawn_blocking(move || {
        fs::list_folder_thumb_samples_batch(folder_paths, options)
    })
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
pub async fn plan_copy_entries(
    paths: Vec<String>,
    destination: String,
) -> Result<fs::CopyPlan, String> {
    tauri::async_runtime::spawn_blocking(move || fs::plan_copy_entries(paths, destination))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn copy_entries(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    window: tauri::Window,
    paths: Vec<String>,
    destination: String,
    options: Option<fs::CopyOptions>,
    transfer_id: Option<String>,
) -> Result<fs::CopyReport, String> {
    let manager = transfer_manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.copy_entries(window, paths, destination, options, transfer_id)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn transfer_entries(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    window: tauri::Window,
    paths: Vec<String>,
    destination: String,
    options: Option<fs::TransferOptions>,
    transfer_id: Option<String>,
) -> Result<fs::TransferReport, String> {
    let manager = transfer_manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.transfer_entries(window, paths, destination, options, transfer_id)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn list_transfer_jobs(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
) -> fs::TransferQueueSnapshot {
    transfer_manager.inner().snapshot()
}

#[tauri::command]
pub fn pause_transfer_job(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    job_id: String,
) -> Result<bool, String> {
    transfer_manager.inner().pause_job(job_id.trim())
}

#[tauri::command]
pub fn resume_transfer_job(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    job_id: String,
) -> Result<bool, String> {
    transfer_manager.inner().resume_job(job_id.trim())
}

#[tauri::command]
pub fn cancel_transfer_job(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    job_id: String,
) -> Result<bool, String> {
    transfer_manager.inner().cancel_job(job_id.trim())
}

#[tauri::command]
pub async fn delete_entries(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    window: tauri::Window,
    paths: Vec<String>,
    transfer_id: Option<String>,
) -> Result<fs::DeleteReport, String> {
    let manager = transfer_manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.delete_entries(window, paths, transfer_id))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn trash_entries(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    window: tauri::Window,
    paths: Vec<String>,
    transfer_id: Option<String>,
) -> Result<fs::TrashReport, String> {
    let manager = transfer_manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.trash_entries(window, paths, transfer_id))
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
pub fn stop_dir_watch(state: tauri::State<'_, watch::DirWatchHandle>) -> Result<(), String> {
    watch::stop_dir_watch(state)
}
