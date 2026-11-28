use tauri::Manager;

mod app;
#[cfg(all(windows, debug_assertions))]
mod dev_profile;
mod domain;
mod platform;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    if platform::windows::menu_host::run_if_requested() {
        return;
    }
    let builder = tauri::Builder::default().on_window_event(|window, event| {
        #[cfg(target_os = "windows")]
        match event {
            tauri::WindowEvent::Focused(true) => {
                platform::dragdrop::schedule_registration(window, false)
            }
            tauri::WindowEvent::Destroyed => {
                window
                    .state::<services::remotes::open::OpenJobs>()
                    .cancel_all();
                window
                    .state::<services::remotes::Remotes>()
                    .clear(window.label());
                window
                    .state::<platform::windows::terminal::Terminals>()
                    .clear(window.label());
                window
                    .state::<platform::windows::dragdrop::IncomingDrops>()
                    .unsubscribe(window.label());
                platform::windows::dragdrop::unregister_drop_target(window.label());
            }
            _ => {}
        }
    });
    #[cfg(target_os = "windows")]
    let builder = builder
        .plugin(platform::windows::profile_instance::init())
        .plugin(platform::windows::webview_navigation::init())
        .manage(platform::windows::dragdrop::IncomingDrops::default())
        .manage(platform::windows::terminal::Terminals::default())
        .manage(services::remotes::Remotes::default())
        .manage(services::remotes::open::OpenJobs::default())
        .manage(platform::windows::menu_host::MenuHost::default())
        .on_page_load(|webview, payload| match payload.event() {
            tauri::webview::PageLoadEvent::Started => {
                webview
                    .state::<services::remotes::open::OpenJobs>()
                    .cancel_all();
                webview
                    .state::<services::remotes::Remotes>()
                    .clear(webview.label());
                webview
                    .state::<platform::windows::terminal::Terminals>()
                    .clear(webview.label());
                webview
                    .state::<platform::windows::dragdrop::IncomingDrops>()
                    .unsubscribe(webview.label());
            }
            tauri::webview::PageLoadEvent::Finished => {
                platform::dragdrop::schedule_registration(&webview.window(), true)
            }
        });

    let builder = services::preview_protocol::register_preview_protocol(builder);
    let context = tauri::generate_context!();
    #[cfg(all(windows, debug_assertions))]
    let context = dev_profile::configure(context);

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Err(error) = platform::windows::profile_instance::register_window(app.handle()) {
                eprintln!("Failed to register the profile window: {error}");
            }
            #[cfg(target_os = "windows")]
            if let Err(error) =
                platform::windows::console::install_console_exit_handler(&app.handle().clone())
            {
                eprintln!("Failed to install console exit handler: {error}");
            }

            #[cfg(target_os = "windows")]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    services::remotes::open::cleanup(&handle)
                });
            }
            let thumbnails = domain::media::thumbs::init(app.handle().clone());
            app.manage(thumbnails);
            app.manage(services::watch::DirWatchHandle::default());
            app.manage(services::transfer_manager::TransferManagerHandle::init());
            app.manage(services::indexed_search::IndexedSearchHandle::init(
                app.handle().clone(),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app::commands::updates::check_app_update,
            app::commands::updates::apply_app_update,
            app::commands::open_stratum_backup,
            app::commands::save_stratum_backup,
            app::commands::probe_backup_folders,
            app::commands::get_home,
            app::commands::get_places,
            app::commands::list_drives,
            app::commands::ensure_dir,
            app::commands::create_folder,
            app::commands::create_tracked_folder,
            app::commands::remove_created_folder_if_empty,
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
            app::commands::begin_transfer_shutdown,
            app::commands::wait_for_transfer_shutdown,
            app::commands::reopen_transfer_queue,
            app::commands::set_clipboard_paths,
            app::commands::set_clipboard_text,
            app::commands::set_remote_clipboard,
            app::commands::get_clipboard_paths,
            app::commands::get_file_clipboard,
            app::commands::finish_file_cut,
            app::commands::delete_entries,
            app::commands::trash_entries,
            app::commands::restore_recycle_items,
            app::commands::validate_batch_rename,
            app::commands::rename_entry,
            app::commands::start_dir_watch,
            app::commands::stop_dir_watch,
            app::commands::start_drag,
            app::commands::release_drop_stage,
            app::commands::file_drop_listener_ready,
            app::commands::cancel_drag_start,
            app::commands::request_thumbnails,
            app::commands::open_thumbnail_scope,
            app::commands::close_thumbnail_scope,
            app::commands::set_thumb_paused,
            app::commands::open_path,
            app::commands::show_shell_context_menu,
            app::commands::warm_shell_context_menu,
            app::commands::open_path_properties,
            app::commands::list_open_with_handlers,
            app::commands::open_path_with_handler,
            app::commands::open_path_with_dialog,
            app::commands::get_indexed_search_catalog_path,
            app::commands::get_indexed_search_status,
            app::commands::set_indexed_search_enabled,
            app::commands::nudge_indexed_search,
            app::commands::list_indexed_drive_statuses,
            app::commands::list_indexable_drive_roots,
            app::commands::query_indexed_paths,
            app::commands::query_indexed_path_page,
            app::commands::query_indexed_folder_page,
            app::commands::quick_move_destination_exists,
            app::commands::rebuild_indexed_drive,
            app::commands::get_thumb_cache_dir,
            app::commands::clear_thumb_cache,
            app::commands::get_thumb_cache_size,
            app::commands::get_image_info,
            app::commands::convert_media_entries,
            app::commands::get_file_icons,
            app::commands::get_executable_icons,
            #[cfg(windows)]
            services::remotes::remote_connect,
            #[cfg(windows)]
            services::remotes::remote_disconnect,
            #[cfg(windows)]
            services::remotes::remote_list,
            services::remotes::properties::remote_properties,
            #[cfg(windows)]
            services::remotes::remote_thumbnail,
            services::remotes::remote_link_target,
            services::remotes::remote_resolve_target,
            services::remotes::operations::remote_create_entry,
            services::remotes::operations::remote_rename_entry,
            services::remotes::operations::remote_move_entry,
            services::remotes::recovery::remote_move_recovery_list,
            services::remotes::recovery_review::remote_recovery_details,
            services::remotes::recovery_review::remote_recovery_acknowledge,
            services::remotes::recovery::remote_finish_interrupted_transfers,
            services::remotes::delete_recovery::remote_acknowledge_delete_recovery,
            services::remotes::recovery::remote_move_recovery_delete,
            services::remotes::recovery::remote_move_destination_stages,
            services::remotes::recovery::remote_move_destination_cleanup,
            services::remotes::recovery::remote_move_recovery_restore,
            services::remotes::recovery::remote_move_recovery_forget,
            services::remotes::operations::remote_delete_entries,
            services::remotes::prepare_remote_video_thumbnail,
            services::remotes::store_remote_video_thumbnail,
            #[cfg(windows)]
            services::remotes::transfer::remote_transfer_file,
            services::remotes::transfer::remote_transfer_batch,
            #[cfg(windows)]
            services::remotes::transfer::preflight::remote_transfer_conflict_decision,
            services::remotes::open::remote_start_open,
            services::remotes::open::remote_cancel_open,
            services::remotes::create_remote_preview_grant,
            services::remotes::store_remote_gallery_thumbnail,
            app::commands::get_shell_availability,
            app::commands::open_shell,
            #[cfg(windows)]
            platform::windows::terminal::terminal_open,
            #[cfg(windows)]
            platform::windows::terminal::fonts::list_terminal_fonts,
            #[cfg(windows)]
            platform::windows::terminal::terminal_link_directory,
            #[cfg(windows)]
            platform::windows::terminal::terminal_read,
            #[cfg(windows)]
            platform::windows::terminal::terminal_write,
            #[cfg(windows)]
            platform::windows::terminal::terminal_resize,
            #[cfg(windows)]
            platform::windows::terminal::terminal_close,
            app::commands::is_windows_11,
            app::commands::get_indexing_launch_preferences,
            app::commands::create_preview_grant,
            app::commands::release_preview_grant,
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code, ref api, .. } = event {
                if let Some(jobs) =
                    app.try_state::<services::transfer_manager::TransferManagerHandle>()
                {
                    if jobs.defer_process_exit(app, code, api) {
                        return;
                    }
                }
            }
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Some(indexed_search) =
                    app.try_state::<services::indexed_search::IndexedSearchHandle>()
                {
                    indexed_search.shutdown();
                }
            }
        });
}
