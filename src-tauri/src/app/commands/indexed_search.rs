// Indexed-search command handlers.
use std::path::Path;

use tauri::Manager;

use crate::domain::indexed_search::{
    IndexedDriveStatus, IndexedFolderPageQuery, IndexedPathMatch, IndexedPathPage,
    IndexedPathPageQuery, IndexedPathQuery, IndexedSearchServiceStatus,
};
use crate::services::indexed_search;

#[tauri::command]
pub fn get_indexed_search_catalog_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(indexed_search::catalog_path_for_app(&app)?
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub async fn get_indexed_search_status(
    app: tauri::AppHandle,
) -> Result<IndexedSearchServiceStatus, String> {
    let indexed_search = app
        .state::<indexed_search::IndexedSearchHandle>()
        .inner()
        .clone();
    match tauri::async_runtime::spawn_blocking(move || indexed_search.service_status()).await {
        Ok(status) => Ok(status),
        Err(_) => Ok(IndexedSearchServiceStatus {
            state: crate::domain::indexed_search::IndexedSearchServiceState::Error,
            catalog_revision: 0,
            activity_label: Some("Indexed-search status is currently unavailable.".to_string()),
            started_at: 0,
            last_updated_at: 0,
            drive_count: 0,
            indexable_drive_count: 0,
            searchable_drive_count: 0,
        }),
    }
}

#[tauri::command]
pub fn set_indexed_search_enabled(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
    enabled: bool,
) {
    indexed_search.set_enabled(enabled);
}

#[tauri::command]
pub fn nudge_indexed_search(
    indexed_search: tauri::State<'_, indexed_search::IndexedSearchHandle>,
) -> Result<(), String> {
    indexed_search.nudge_indexed_search()
}

#[tauri::command]
pub async fn list_indexed_drive_statuses(
    app: tauri::AppHandle,
) -> Result<Vec<IndexedDriveStatus>, String> {
    let indexed_search = app
        .state::<indexed_search::IndexedSearchHandle>()
        .inner()
        .clone();
    match tauri::async_runtime::spawn_blocking(move || indexed_search.drive_statuses()).await {
        Ok(statuses) => Ok(statuses),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn query_indexed_paths(
    app: tauri::AppHandle,
    query: IndexedPathQuery,
) -> Result<Vec<IndexedPathMatch>, String> {
    let indexed_search = app
        .state::<indexed_search::IndexedSearchHandle>()
        .inner()
        .clone();
    match tauri::async_runtime::spawn_blocking(move || indexed_search.query_paths(query)).await {
        Ok(result) => result,
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn query_indexed_path_page(
    app: tauri::AppHandle,
    query: IndexedPathPageQuery,
) -> Result<IndexedPathPage, String> {
    let indexed_search = app
        .state::<indexed_search::IndexedSearchHandle>()
        .inner()
        .clone();
    tauri::async_runtime::spawn_blocking(move || indexed_search.query_path_page(query))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn query_indexed_folder_page(
    app: tauri::AppHandle,
    query: IndexedFolderPageQuery,
) -> Result<IndexedPathPage, String> {
    let indexed_search = app
        .state::<indexed_search::IndexedSearchHandle>()
        .inner()
        .clone();
    tauri::async_runtime::spawn_blocking(move || indexed_search.query_folder_page(query))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn quick_move_destination_exists(
    app: tauri::AppHandle,
    path: String,
) -> Result<bool, String> {
    let indexed_search = app
        .state::<indexed_search::IndexedSearchHandle>()
        .inner()
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        absolute_drive_root(path)
            .is_some_and(|drive| indexed_search.verify_searchable_drive(&drive) && path.is_dir())
    })
    .await
    .map_err(|error| error.to_string())
}

fn absolute_drive_root(path: &Path) -> Option<String> {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        if !path.is_absolute() {
            return None;
        }
        let Some(Component::Prefix(prefix)) = path.components().next() else {
            return None;
        };
        let (Prefix::Disk(letter) | Prefix::VerbatimDisk(letter)) = prefix.kind() else {
            return None;
        };
        Some(format!("{}:\\", char::from(letter)))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

#[cfg(all(test, windows))]
#[test]
fn quick_move_accepts_absolute_drive_folders_only() {
    assert_eq!(
        absolute_drive_root(Path::new(r"E:\Photos")).as_deref(),
        Some(r"E:\")
    );
    assert_eq!(
        absolute_drive_root(Path::new(r"\\?\E:\Photos")).as_deref(),
        Some(r"E:\")
    );
    assert_eq!(absolute_drive_root(Path::new(r"E:Photos")), None);
    assert_eq!(
        absolute_drive_root(Path::new(r"\\server\share\Photos")),
        None
    );
}

#[tauri::command]
pub async fn rebuild_indexed_drive(
    app: tauri::AppHandle,
    drive_path: String,
) -> Result<bool, String> {
    let indexed_search = app
        .state::<indexed_search::IndexedSearchHandle>()
        .inner()
        .clone();
    match tauri::async_runtime::spawn_blocking(move || {
        indexed_search.request_drive_rebuild(drive_path)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(error.to_string()),
    }
}
