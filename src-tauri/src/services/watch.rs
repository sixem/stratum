// Directory watch state and event emission for lightweight refresh signals.
use std::path::Path;
use std::sync::{Arc, Mutex};

use notify::{
    event::{ModifyKind, RenameMode},
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::indexed_search::IndexedSearchHandle;

#[derive(Clone, Default)]
pub struct DirWatchHandle {
    state: Arc<[Mutex<DirWatchState>; 2]>,
}

#[derive(Default)]
struct DirWatchState {
    generation: u64,
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

impl DirWatchHandle {
    // Opening a watcher can wait on an unavailable share. Only the latest
    // request may install one, and the state lock never covers filesystem I/O.
    pub fn set_target(
        &self,
        pane: crate::domain::filesystem::FilePane,
        path: Option<String>,
        generation: Option<u64>,
        open: impl FnOnce(&str) -> Result<RecommendedWatcher, String>,
    ) -> Result<(), String> {
        let (generation, previous) = {
            let mut state = self.state[pane as usize]
                .lock()
                .map_err(|_| "dir watch state unavailable")?;
            let generation = generation.unwrap_or_else(|| state.generation.saturating_add(1));
            if generation < state.generation {
                return Ok(());
            }
            state.generation = generation;
            if state.path == path {
                return Ok(());
            }
            state.path = None;
            (generation, state.watcher.take())
        };
        // Dropping a watcher releases its watches on the blocking worker.
        drop(previous);
        if let Some(path) = path {
            let watcher = open(&path);
            let mut state = self.state[pane as usize]
                .lock()
                .map_err(|_| "dir watch state unavailable")?;
            if state.generation == generation {
                let watcher = watcher?;
                state.path = Some(path);
                state.watcher = Some(watcher);
            }
        }
        Ok(())
    }
}

pub fn open_dir_watch(app_handle: AppHandle, path: &str) -> Result<RecommendedWatcher, String> {
    let target_path = path.to_string();
    let indexed_search = app_handle
        .try_state::<IndexedSearchHandle>()
        .map(|state| state.inner().clone());
    let rename_buffer = Mutex::new(None::<String>);
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
            if let Some(index) = indexed_search.as_ref().filter(|index| index.is_enabled()) {
                let paths = indexed_watch_paths(Path::new(&target_path), &event);
                if !paths.is_empty() {
                    if let Err(error) = index.queue_watched_paths(&paths) {
                        eprintln!(
                            "[indexed-search] Could not queue a folder notification: {error}"
                        );
                    }
                }
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
        .watch(Path::new(path), RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;

    Ok(watcher)
}

fn indexed_watch_paths<'a>(target: &Path, event: &'a Event) -> Vec<&'a str> {
    // Index rows only track path and kind. Ignore content and attribute writes,
    // which can generate many notifications during one save.
    if event.need_rescan()
        || !matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
        )
    {
        return Vec::new();
    }
    // The pane watch is nonrecursive. Each half of a rename is useful on
    // its own because moving across folders may emit only one half here.
    event
        .paths
        .iter()
        .filter_map(|path| {
            let relative = path.strip_prefix(target).ok()?;
            let mut components = relative.components();
            if !matches!(components.next(), Some(std::path::Component::Normal(_)))
                || components.next().is_some()
            {
                return None;
            }
            path.to_str()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, thread, time::Duration};

    #[test]
    fn indexed_watch_admits_structural_changes_to_direct_children() {
        use notify::event::{CreateKind, RemoveKind};

        let parent = Path::new("folder");
        let child = parent.join("new.txt");
        for kind in [
            EventKind::Create(CreateKind::Any),
            EventKind::Remove(RemoveKind::Any),
            EventKind::Modify(ModifyKind::Name(RenameMode::From)),
            EventKind::Modify(ModifyKind::Name(RenameMode::To)),
        ] {
            let event = Event::new(kind)
                .add_path(child.clone())
                .add_path(parent.join("subfolder").join("nested.txt"))
                .add_path(parent.into());
            assert_eq!(
                indexed_watch_paths(parent, &event),
                [child.to_str().unwrap()]
            );
        }
        let write = Event::new(EventKind::Modify(ModifyKind::Any)).add_path(child);
        assert!(indexed_watch_paths(parent, &write).is_empty());
    }

    #[test]
    fn closing_the_bottom_watch_preserves_the_main_watch() {
        use crate::domain::filesystem::FilePane::{Bottom, Main};
        let handle = DirWatchHandle::default();
        for (pane, path) in [(Main, "upper"), (Bottom, "lower")] {
            handle
                .set_target(pane, Some(path.into()), Some(1), |_| {
                    notify::recommended_watcher(|_| {}).map_err(|err| err.to_string())
                })
                .unwrap();
        }
        handle
            .set_target(Bottom, None, Some(2), |_| unreachable!())
            .unwrap();
        assert_eq!(
            handle.state[Main as usize].lock().unwrap().path.as_deref(),
            Some("upper")
        );
        assert!(handle.state[Bottom as usize]
            .lock()
            .unwrap()
            .watcher
            .is_none());
    }

    #[test]
    fn a_blocked_watch_cannot_replace_a_newer_watch_or_restart_after_stop() {
        let handle = DirWatchHandle::default();
        let (opened, wait_for_open) = mpsc::channel();
        let (release, wait_for_release) = mpsc::channel();
        let older = handle.clone();
        let slow = thread::spawn(move || {
            older.set_target(Default::default(), Some("slow".into()), Some(1), |_| {
                opened.send(()).unwrap();
                wait_for_release
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap();
                notify::recommended_watcher(|_| {}).map_err(|err| err.to_string())
            })
        });
        wait_for_open.recv_timeout(Duration::from_secs(5)).unwrap();
        handle
            .set_target(Default::default(), Some("latest".into()), Some(3), |_| {
                notify::recommended_watcher(|_| {}).map_err(|err| err.to_string())
            })
            .unwrap();
        release.send(()).unwrap();
        slow.join().unwrap().unwrap();
        handle
            .set_target(Default::default(), None, Some(2), |_| unreachable!())
            .unwrap();
        assert_eq!(
            handle.state[0].lock().unwrap().path.as_deref(),
            Some("latest")
        );

        handle
            .set_target(Default::default(), None, Some(5), |_| unreachable!())
            .unwrap();
        handle
            .set_target(
                Default::default(),
                Some("late start".into()),
                Some(4),
                |_| panic!("stale request opened a watcher"),
            )
            .unwrap();
        assert!(handle.state[0].lock().unwrap().watcher.is_none());
    }
}
