// Cross-platform entrypoint for native drag-and-drop.
// Windows gets a custom drop target so we can receive virtual drops like 7-Zip.
#[cfg(target_os = "windows")]
pub fn schedule_registration(window: &tauri::Window, page_loaded: bool) {
    let target = window.clone();
    // OLE registrations belong to the window's apartment.
    if let Err(err) = window.run_on_main_thread(move || {
        if let Err(err) = super::windows::dragdrop::register_drop_target(&target, page_loaded) {
            eprintln!("Failed to register file drop target: {err}");
        }
    }) {
        eprintln!("Failed to schedule file drop registration: {err}");
    }
}
