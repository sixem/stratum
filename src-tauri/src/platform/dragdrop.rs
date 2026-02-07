// Cross-platform entrypoint for native drag-and-drop.
// Windows gets a custom drop target so we can receive virtual drops like 7-Zip.
#[cfg(target_os = "windows")]
pub use crate::platform::windows::dragdrop::register_drop_target;

#[cfg(not(target_os = "windows"))]
pub fn register_drop_target(_window: tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}
