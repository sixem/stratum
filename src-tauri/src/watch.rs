// Directory watch state and event emission for lightweight refresh signals.
use std::path::Path;
use std::sync::Mutex;

use notify::{
    event::{ModifyKind, RenameMode},
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct DirWatchHandle {
    state: Mutex<DirWatchState>,
}

#[derive(Default)]
struct DirWatchState {
    path: Option<String>,
    watcher: Option<RecommendedWatcher>,
}

#[derive(Clone, Serialize)]
struct DirChangedPayload {
    path: String,
    paths: Vec<String>,
}

#[derive(Clone, Serialize)]
struct DirRenamePayload {
    path: String,
    from: String,
    to: String,
    paths: Vec<String>,
}

fn clear_watch(state: &mut DirWatchState) {
    if let Some(mut watcher) = state.watcher.take() {
        if let Some(path) = state.path.take() {
            let _ = watcher.unwatch(Path::new(&path));
        }
    }
    state.path = None;
}

#[tauri::command]
pub fn start_dir_watch(
    app: AppHandle,
    path: String,
    state: State<'_, DirWatchHandle>,
) -> Result<(), String> {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return stop_dir_watch(state);
    }
    let mut guard = state
        .state
        .lock()
        .map_err(|_| "dir watch state unavailable".to_string())?;
    if guard.path.as_deref() == Some(trimmed.as_str()) {
        return Ok(());
    }
    clear_watch(&mut guard);

    let target_path = trimmed.clone();
    let app_handle = app.clone();
    let rename_buffer = std::sync::Arc::new(Mutex::new(None::<String>));
    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            let event: Event = match result {
                Ok(value) => value,
                Err(_) => return,
            };
            // Ignore access-only events to reduce noisy refreshes.
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            let event_paths: Vec<String> = event
                .paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            if let EventKind::Modify(ModifyKind::Name(mode)) = event.kind {
                match mode {
                    RenameMode::From => {
                        if let Some(path) = event.paths.get(0) {
                            if let Ok(mut guard) = rename_buffer.lock() {
                                *guard = Some(path.to_string_lossy().to_string());
                            }
                        }
                        return;
                    }
                    RenameMode::To => {
                        if let Some(to_path) = event.paths.get(0) {
                            let to = to_path.to_string_lossy().to_string();
                            if let Ok(mut guard) = rename_buffer.lock() {
                                if let Some(from) = guard.take() {
                                    let payload = DirRenamePayload {
                                        path: target_path.clone(),
                                        from: from.clone(),
                                        to: to.clone(),
                                        paths: vec![from, to],
                                    };
                                    let _ = app_handle.emit("dir_rename", payload);
                                    return;
                                }
                            }
                        }
                    }
                    RenameMode::Both => {
                        if event.paths.len() >= 2 {
                            let payload = DirRenamePayload {
                                path: target_path.clone(),
                                from: event.paths[0].to_string_lossy().to_string(),
                                to: event.paths[1].to_string_lossy().to_string(),
                                paths: event_paths.clone(),
                            };
                            let _ = app_handle.emit("dir_rename", payload);
                            return;
                        }
                    }
                    _ => {}
                }
            }
            let payload = DirChangedPayload {
                path: target_path.clone(),
                paths: event_paths,
            };
            let _ = app_handle.emit("dir_changed", payload);
        },
        notify::Config::default(),
    )
    .map_err(|error| error.to_string())?;

    watcher
        .watch(Path::new(&trimmed), RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;

    guard.path = Some(trimmed);
    guard.watcher = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn stop_dir_watch(state: State<'_, DirWatchHandle>) -> Result<(), String> {
    let mut guard = state
        .state
        .lock()
        .map_err(|_| "dir watch state unavailable".to_string())?;
    clear_watch(&mut guard);
    Ok(())
}
