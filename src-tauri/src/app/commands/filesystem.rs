// Filesystem-centric command handlers.
use crate::domain::filesystem as fs;
use crate::services::indexed_search;
use crate::services::transfer_manager;
use crate::services::watch;
use std::path::Path;

fn reconcile_indexed_search_paths(
    indexed_search: &indexed_search::IndexedSearchHandle,
    paths: Vec<String>,
    context: &str,
) {
    if let Err(error) = indexed_search.reconcile_paths(paths) {
        eprintln!("Indexed-search reconcile failed after {context}: {error}");
    }
}

fn queue_indexed_search_reconcile(
    indexed_search: indexed_search::IndexedSearchHandle,
    paths: Vec<String>,
    context: &'static str,
) {
    // Indexed-search refresh is follow-up work. Queue it after the filesystem
    // command settles so user-visible completion is not gated on catalog writes.
    tauri::async_runtime::spawn_blocking(move || {
        reconcile_indexed_search_paths(&indexed_search, paths, context);
    });
}

fn queue_reconcile_after_create(
    indexed_search: indexed_search::IndexedSearchHandle,
    paths: Vec<String>,
    context: &'static str,
) {
    queue_indexed_search_reconcile(indexed_search, paths, context);
}

fn queue_reconcile_after_copy(
    indexed_search: indexed_search::IndexedSearchHandle,
    source_paths: &[String],
    destination: &str,
    context: &'static str,
) {
    let reconcile_paths = build_expected_destination_paths(source_paths, destination);
    queue_indexed_search_reconcile(indexed_search, reconcile_paths, context);
}

fn queue_reconcile_after_move(
    indexed_search: indexed_search::IndexedSearchHandle,
    source_paths: &[String],
    destination: &str,
    context: &'static str,
) {
    let destination_paths = build_expected_destination_paths(source_paths, destination);
    let mut reconcile_paths = source_paths.to_vec();
    reconcile_paths.extend(destination_paths);
    queue_indexed_search_reconcile(indexed_search, reconcile_paths, context);
}

fn queue_reconcile_after_move_paths(
    indexed_search: indexed_search::IndexedSearchHandle,
    removed_paths: Vec<String>,
    created_paths: Vec<String>,
    context: &'static str,
) {
    let mut reconcile_paths = removed_paths;
    reconcile_paths.extend(created_paths);
    queue_indexed_search_reconcile(indexed_search, reconcile_paths, context);
}

fn queue_reconcile_after_delete(
    indexed_search: indexed_search::IndexedSearchHandle,
    paths: Vec<String>,
    context: &'static str,
) {
    queue_indexed_search_reconcile(indexed_search, paths, context);
}

async fn run_reconcile_after_create_command<T, F>(
    indexed_search: indexed_search::IndexedSearchHandle,
    paths: Vec<String>,
    context: &'static str,
    command: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let result = tauri::async_runtime::spawn_blocking(command)
        .await
        .map_err(|err| err.to_string())??;
    queue_reconcile_after_create(indexed_search, paths, context);
    Ok(result)
}

async fn run_reconcile_after_copy_command<T, F>(
    indexed_search: indexed_search::IndexedSearchHandle,
    source_paths: Vec<String>,
    destination: String,
    context: &'static str,
    command: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let result = tauri::async_runtime::spawn_blocking(command)
        .await
        .map_err(|err| err.to_string())??;
    queue_reconcile_after_copy(indexed_search, &source_paths, &destination, context);
    Ok(result)
}

async fn run_reconcile_after_move_command<T, F>(
    indexed_search: indexed_search::IndexedSearchHandle,
    source_paths: Vec<String>,
    destination: String,
    context: &'static str,
    command: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let result = tauri::async_runtime::spawn_blocking(command)
        .await
        .map_err(|err| err.to_string())??;
    queue_reconcile_after_move(indexed_search, &source_paths, &destination, context);
    Ok(result)
}

async fn run_reconcile_after_delete_command<T, F>(
    indexed_search: indexed_search::IndexedSearchHandle,
    paths: Vec<String>,
    context: &'static str,
    command: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let result = tauri::async_runtime::spawn_blocking(command)
        .await
        .map_err(|err| err.to_string())??;
    queue_reconcile_after_delete(indexed_search, paths, context);
    Ok(result)
}

fn build_expected_destination_paths(paths: &[String], destination: &str) -> Vec<String> {
    let destination_path = Path::new(destination.trim());
    paths
        .iter()
        .filter_map(|path| {
            let source_path = Path::new(path.trim());
            let name = source_path.file_name()?;
            Some(destination_path.join(name).to_string_lossy().to_string())
        })
        .collect()
}

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
pub async fn ensure_dir(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    path: String,
) -> Result<(), String> {
    let indexed_search = indexed_search.inner().clone();
    let reconcile_path = path.clone();
    run_reconcile_after_create_command(
        indexed_search,
        vec![reconcile_path],
        "ensure_dir",
        move || fs::ensure_dir(path),
    )
    .await
}

#[tauri::command]
pub async fn create_folder(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    path: String,
) -> Result<(), String> {
    let indexed_search = indexed_search.inner().clone();
    let reconcile_path = path.clone();
    run_reconcile_after_create_command(
        indexed_search,
        vec![reconcile_path],
        "create_folder",
        move || fs::create_folder(path),
    )
    .await
}

#[tauri::command]
pub async fn create_file(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    path: String,
) -> Result<(), String> {
    let indexed_search = indexed_search.inner().clone();
    let reconcile_path = path.clone();
    run_reconcile_after_create_command(
        indexed_search,
        vec![reconcile_path],
        "create_file",
        move || fs::create_file(path),
    )
    .await
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
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    window: tauri::Window,
    paths: Vec<String>,
    destination: String,
    options: Option<fs::CopyOptions>,
    transfer_id: Option<String>,
) -> Result<fs::CopyReport, String> {
    let manager = transfer_manager.inner().clone();
    let indexed_search = indexed_search.inner().clone();
    let reconcile_sources = paths.clone();
    let reconcile_destination = destination.clone();
    run_reconcile_after_copy_command(
        indexed_search,
        reconcile_sources,
        reconcile_destination,
        "copy_entries",
        move || manager.copy_entries(window, paths, destination, options, transfer_id),
    )
    .await
}

#[tauri::command]
pub async fn transfer_entries(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    window: tauri::Window,
    paths: Vec<String>,
    destination: String,
    options: Option<fs::TransferOptions>,
    transfer_id: Option<String>,
) -> Result<fs::TransferReport, String> {
    let manager = transfer_manager.inner().clone();
    let indexed_search = indexed_search.inner().clone();
    let reconcile_sources = paths.clone();
    let reconcile_destination = destination.clone();
    run_reconcile_after_move_command(
        indexed_search,
        reconcile_sources,
        reconcile_destination,
        "transfer_entries",
        move || manager.transfer_entries(window, paths, destination, options, transfer_id),
    )
    .await
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
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    window: tauri::Window,
    paths: Vec<String>,
    transfer_id: Option<String>,
) -> Result<fs::DeleteReport, String> {
    let manager = transfer_manager.inner().clone();
    let indexed_search = indexed_search.inner().clone();
    let reconcile_paths = paths.clone();
    run_reconcile_after_delete_command(
        indexed_search,
        reconcile_paths,
        "delete_entries",
        move || manager.delete_entries(window, paths, transfer_id),
    )
    .await
}

#[tauri::command]
pub async fn trash_entries(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    window: tauri::Window,
    paths: Vec<String>,
    transfer_id: Option<String>,
) -> Result<fs::TrashReport, String> {
    let manager = transfer_manager.inner().clone();
    let indexed_search = indexed_search.inner().clone();
    let reconcile_paths = paths.clone();
    run_reconcile_after_delete_command(
        indexed_search,
        reconcile_paths,
        "trash_entries",
        move || manager.trash_entries(window, paths, transfer_id),
    )
    .await
}

#[tauri::command]
pub async fn restore_recycle_entries(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    entries: Vec<fs::RecycleEntry>,
) -> Result<fs::RestoreReport, String> {
    let indexed_search = indexed_search.inner().clone();
    let reconcile_paths = entries
        .iter()
        .map(|entry| entry.original_path.clone())
        .collect::<Vec<_>>();
    run_reconcile_after_create_command(
        indexed_search,
        reconcile_paths,
        "restore_recycle_entries",
        move || fs::restore_recycle_entries(entries),
    )
    .await
}

#[tauri::command]
pub async fn restore_recycle_paths(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    paths: Vec<String>,
    min_deleted_at: Option<u64>,
) -> Result<fs::RestorePathsReport, String> {
    let indexed_search = indexed_search.inner().clone();
    let reconcile_paths = paths.clone();
    run_reconcile_after_create_command(
        indexed_search,
        reconcile_paths,
        "restore_recycle_paths",
        move || fs::restore_recycle_paths(paths, min_deleted_at),
    )
    .await
}

#[tauri::command]
pub async fn rename_entry(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    path: String,
    new_name: String,
) -> Result<String, String> {
    let indexed_search = indexed_search.inner().clone();
    let reconcile_source = path.clone();
    let next_path = tauri::async_runtime::spawn_blocking(move || fs::rename_entry(path, new_name))
        .await
        .map_err(|err| err.to_string())??;
    queue_reconcile_after_move_paths(
        indexed_search,
        vec![reconcile_source],
        vec![next_path.clone()],
        "rename_entry",
    );
    Ok(next_path)
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
