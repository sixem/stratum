// Let Stratum draw its own frame while keeping the native window shadow.
use tauri::{AppHandle, Manager};
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE};

pub(crate) fn hide_system_border(app: &AppHandle) {
    let Some(hwnd) = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
    else {
        return;
    };

    let color = DWMWA_COLOR_NONE;
    // Windows 11 supports this attribute. Older versions retain their default frame behavior.
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            (&color as *const u32).cast(),
            size_of::<u32>() as u32,
        )
    };
}
