use tauri::Manager;

mod app;
mod domain;
mod platform;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().on_window_event({
        #[cfg(target_os = "windows")]
        let registered: std::sync::Arc<
            std::sync::Mutex<std::collections::HashSet<String>>,
        > = std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashSet::new()));
        #[cfg(target_os = "windows")]
        let registered = registered.clone();
        move |window, event| {
            #[cfg(target_os = "windows")]
            {
                // Experimental resize smoothing: a tiny sleep can reduce how aggressively
                // the WebView resize path thrashes during a live drag on Windows.
                if let tauri::WindowEvent::Resized(_) = event {
                    std::thread::sleep(std::time::Duration::from_nanos(1));
                }

                // Register the custom drop target once per window label.
                let label = window.label().to_string();
                let mut seen = match registered.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                if !seen.insert(label.clone()) {
                    return;
                }
                if let Some(webview_window) = window.app_handle().get_webview_window(&label) {
                    match platform::dragdrop::register_drop_target(webview_window) {
                        Ok(()) => {
                            // Keep the label in the set so we do not re-register on future events.
                        }
                        Err(error) => {
                            eprintln!("Failed to register drop target: {error}");
                        }
                    }
                }
            }
        }
    });

    let builder = services::preview_protocol::register_preview_protocol(builder);

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Err(error) =
                platform::windows::console::install_console_exit_handler(&app.handle().clone())
            {
                eprintln!("Failed to install console exit handler: {error}");
            }

            let thumbnails = domain::media::thumbs::init(app.handle().clone());
            app.manage(thumbnails);
            app.manage(services::watch::DirWatchHandle::default());
            app.manage(services::transfer_manager::TransferManagerHandle::init());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app::commands::get_home,
            app::commands::get_places,
            app::commands::list_drives,
            app::commands::ensure_dir,
            app::commands::create_folder,
            app::commands::create_file,
            app::commands::list_drive_info,
            app::commands::list_dir,
            app::commands::list_dir_with_parent,
            app::commands::stat_entries,
            app::commands::list_folder_thumb_samples_batch,
            app::commands::parent_dir,
            app::commands::plan_copy_entries,
            app::commands::copy_entries,
            app::commands::transfer_entries,
            app::commands::list_transfer_jobs,
            app::commands::pause_transfer_job,
            app::commands::resume_transfer_job,
            app::commands::cancel_transfer_job,
            app::commands::set_clipboard_paths,
            app::commands::get_clipboard_paths,
            app::commands::delete_entries,
            app::commands::trash_entries,
            app::commands::restore_recycle_entries,
            app::commands::restore_recycle_paths,
            app::commands::rename_entry,
            app::commands::start_dir_watch,
            app::commands::stop_dir_watch,
            app::commands::start_drag,
            app::commands::request_thumbnails,
            app::commands::set_thumb_paused,
            app::commands::open_path,
            app::commands::open_path_properties,
            app::commands::list_open_with_handlers,
            app::commands::open_path_with_handler,
            app::commands::open_path_with_dialog,
            app::commands::get_thumb_cache_dir,
            app::commands::clear_thumb_cache,
            app::commands::get_thumb_cache_size,
            app::commands::get_image_info,
            app::commands::convert_media_entries,
            app::commands::get_file_icons,
            app::commands::get_shell_availability,
            app::commands::open_shell,
            app::commands::is_windows_11
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
