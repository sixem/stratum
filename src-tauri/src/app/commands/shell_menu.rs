// The WebView provides physical client coordinates for either a mouse or keyboard anchor.
use crate::platform::ShellMenuOutcome;

#[tauri::command]
pub async fn warm_shell_context_menu(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    {
        use crate::platform::windows::menu_host::MenuHost;
        use tauri::Manager;
        let _ = tauri::async_runtime::spawn_blocking(move || app.state::<MenuHost>().warm()).await;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

#[tauri::command]
pub async fn show_shell_context_menu(
    window: tauri::Window,
    paths: Vec<String>,
    x: i32,
    y: i32,
    background_path: Option<String>,
    extended: Option<bool>,
    offer_gallery: Option<bool>,
) -> Result<ShellMenuOutcome, String> {
    #[cfg(target_os = "windows")]
    {
        use crate::platform::windows::menu_host::MenuHost;
        use tauri::Manager;
        use windows::Win32::Foundation::POINT;
        tauri::async_runtime::spawn_blocking(move || {
            let hwnd = window.hwnd().map_err(|error| error.to_string())?;
            window.state::<MenuHost>().show(
                hwnd,
                paths,
                background_path,
                POINT { x, y },
                extended.unwrap_or(false),
                offer_gallery.unwrap_or(false),
            )
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (
            window,
            paths,
            x,
            y,
            background_path,
            extended,
            offer_gallery,
        );
        Err("The Windows context menu is unavailable on this platform.".into())
    }
}
