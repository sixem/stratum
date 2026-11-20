// Indexed-search command handlers.
use tauri::Manager;

use crate::domain::indexed_search::{
    IndexedDriveStatus, IndexedPathMatch, IndexedPathQuery, IndexedSearchServiceStatus,
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
