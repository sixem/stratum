// Media-oriented command handlers (thumbnails, icons, conversion).
use crate::domain::media::{file_icons, images, thumbs};

#[tauri::command]
pub async fn request_thumbnails(
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
pub fn set_thumb_paused(
    paused: bool,
    state: tauri::State<'_, thumbs::ThumbnailHandle>,
) -> Result<(), String> {
    thumbs::set_paused(state.inner().as_ref(), paused);
    Ok(())
}

#[tauri::command]
pub async fn get_thumb_cache_dir(app: tauri::AppHandle) -> String {
    thumbs::get_cache_dir(&app).to_string_lossy().to_string()
}

#[tauri::command]
pub async fn clear_thumb_cache(app: tauri::AppHandle) -> Result<(), String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || thumbs::clear_cache_dir(&handle))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_thumb_cache_size(app: tauri::AppHandle) -> Result<u64, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || thumbs::get_cache_size(&handle))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_file_icons(
    app: tauri::AppHandle,
    extensions: Vec<String>,
) -> Result<Vec<file_icons::FileIconHit>, String> {
    tauri::async_runtime::spawn_blocking(move || file_icons::get_file_icons(&app, extensions))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn get_image_info(path: String) -> Result<images::ImageInfo, String> {
    tauri::async_runtime::spawn_blocking(move || images::get_image_info(path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn convert_image(
    path: String,
    destination: String,
    options: images::ImageConvertOptions,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || images::convert_image(path, destination, options))
        .await
        .map_err(|err| err.to_string())?
}
