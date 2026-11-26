// Filesystem-centric command handlers.
use crate::domain::filesystem as fs;
use crate::services::indexed_search;
use crate::services::transfer_manager;
use crate::services::watch;
use std::path::Path;
use tauri::Manager;

fn queue_indexed_search_reconcile(
    indexed_search: indexed_search::IndexedSearchHandle,
    paths: Vec<String>,
    context: &'static str,
) {
    if let Err(error) = indexed_search.queue_reconcile_paths(paths) {
        eprintln!("Indexed-search queue failed after {context}: {error}");
    }
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
pub async fn create_tracked_folder(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    parent: String,
    name: String,
) -> Result<fs::CreatedFolder, String> {
    let path = std::path::Path::new(parent.trim())
        .join(&name)
        .to_string_lossy()
        .into_owned();
    run_reconcile_after_create_command(
        indexed_search.inner().clone(),
        vec![path],
        "create_tracked_folder",
        move || fs::create_tracked_folder(parent, name),
    )
    .await
}

#[tauri::command]
pub async fn remove_created_folder_if_empty(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    folder: fs::CreatedFolder,
) -> Result<bool, String> {
    run_reconcile_after_delete_command(
        indexed_search.inner().clone(),
        vec![folder.path.clone()],
        "remove_created_folder_if_empty",
        move || fs::remove_created_folder_if_empty(folder),
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
    webview: tauri::Webview,
    paths: Vec<String>,
    destination: String,
    options: Option<fs::TransferOptions>,
    transfer_id: Option<String>,
    drop_stage: Option<u64>,
) -> Result<fs::TransferReport, String> {
    let window = webview.window();
    #[cfg(windows)]
    let stage = drop_stage
        .map(|id| {
            use crate::platform::windows::dragdrop::{
                staged_path_spelling_supported, IncomingDrops,
            };
            use tauri::Manager;

            if !matches!(
                options.as_ref().and_then(|options| options.mode),
                Some(fs::TransferMode::Copy)
            ) {
                return Err("Temporary dropped files must be copied.".into());
            }
            if !staged_path_spelling_supported(&destination) {
                return Err(
                    "Choose a destination folder whose name does not end in whitespace.".into(),
                );
            }
            webview
                .state::<IncomingDrops>()
                .take_for_transfer(webview.label(), id, &paths)
        })
        .transpose()?;
    #[cfg(not(windows))]
    let _ = drop_stage;

    let manager = transfer_manager.inner().clone();
    let indexed_search = indexed_search.inner().clone();
    let reconcile_sources = paths.clone();
    let reconcile_destination = destination.clone();
    run_reconcile_after_move_command(
        indexed_search,
        reconcile_sources,
        reconcile_destination,
        "transfer_entries",
        move || {
            manager.transfer_entries(
                window,
                paths,
                destination,
                options,
                transfer_id,
                #[cfg(windows)]
                stage,
            )
        },
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
pub async fn cancel_transfer_job(
    transfer_manager: tauri::State<'_, transfer_manager::TransferManagerHandle>,
    job_id: String,
) -> Result<bool, String> {
    let manager = transfer_manager.inner().clone();
    // Canceling a queued drop may release its staged files.
    tauri::async_runtime::spawn_blocking(move || manager.cancel_job(job_id.trim()))
        .await
        .map_err(|error| error.to_string())?
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
pub async fn restore_recycle_items(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    receipt_id: String,
) -> Result<fs::RestoreRecycleReport, String> {
    let indexed_search = indexed_search.inner().clone();
    let report =
        tauri::async_runtime::spawn_blocking(move || fs::restore_recycle_items(receipt_id))
            .await
            .map_err(|err| err.to_string())??;
    queue_reconcile_after_create(
        indexed_search,
        report.restored_paths.clone(),
        "restore_recycle_items",
    );
    Ok(report)
}

#[tauri::command]
pub async fn validate_batch_rename(
    requests: Vec<fs::BatchRenameRequest>,
) -> Result<Vec<Option<String>>, String> {
    tauri::async_runtime::spawn_blocking(move || fs::validate_batch_rename(requests))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn rename_entry(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    path: String,
    new_name: String,
    expected_identity: Option<fs::EntryIdentity>,
) -> Result<fs::RenamedEntry, String> {
    let indexed_search = indexed_search.inner().clone();
    let reconcile_source = path.clone();
    let renamed = tauri::async_runtime::spawn_blocking(move || {
        fs::rename_entry(path, new_name, expected_identity)
    })
    .await
    .map_err(|err| err.to_string())??;
    queue_reconcile_after_move_paths(
        indexed_search,
        vec![reconcile_source],
        vec![renamed.path.clone()],
        "rename_entry",
    );
    Ok(renamed)
}

#[tauri::command]
pub async fn start_dir_watch(
    app: tauri::AppHandle,
    path: String,
    pane: Option<fs::FilePane>,
    generation: Option<u64>,
    restart: Option<bool>,
    state: tauri::State<'_, watch::DirWatchHandle>,
) -> Result<(), String> {
    let path = path.trim();
    let target = (!path.is_empty()).then(|| path.to_string());
    update_dir_watch(
        app,
        state.inner().clone(),
        target,
        pane,
        generation,
        restart.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn stop_dir_watch(
    app: tauri::AppHandle,
    pane: Option<fs::FilePane>,
    generation: Option<u64>,
    state: tauri::State<'_, watch::DirWatchHandle>,
) -> Result<(), String> {
    update_dir_watch(app, state.inner().clone(), None, pane, generation, false).await
}

async fn update_dir_watch(
    app: tauri::AppHandle,
    state: watch::DirWatchHandle,
    target: Option<String>,
    pane: Option<fs::FilePane>,
    generation: Option<u64>,
    restart: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = target.as_deref();
        let installed = state.set_target(
            pane.unwrap_or_default(),
            target,
            generation,
            restart,
            |path, active| watch::open_dir_watch(app.clone(), path, active),
        )?;
        if let Some(path) = target.filter(|_| installed) {
            if let Some(index) = app.try_state::<indexed_search::IndexedSearchHandle>() {
                if let Err(error) = index.queue_visited_folder(path) {
                    eprintln!("[indexed-search] Could not queue a visited folder: {error}");
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}
