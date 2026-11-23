// Directory watch state and event emission for lightweight refresh signals.
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
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
    active: Option<Arc<AtomicBool>>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirChangedPayload {
    path: String,
    paths: Vec<String>,
    #[serde(skip_serializing_if = "is_false")]
    rescan: bool,
    #[serde(skip_serializing_if = "is_false")]
    watch_failed: bool,
    #[serde(skip_serializing_if = "is_false")]
    writing: bool,
}

fn is_false(value: &bool) -> bool {
    !value
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
        path: Option<&str>,
        generation: Option<u64>,
        restart: bool,
        open: impl FnOnce(&str, Arc<AtomicBool>) -> Result<RecommendedWatcher, String>,
    ) -> Result<bool, String> {
        let (previous, active) = {
            let mut state = self.state[pane as usize]
                .lock()
                .map_err(|_| "dir watch state unavailable")?;
            let generation = generation.unwrap_or_else(|| state.generation.saturating_add(1));
            if generation < state.generation {
                return Ok(false);
            }
            state.generation = generation;
            let changed = state.path.as_deref() != path;
            if !changed
                && !restart
                && state
                    .active
                    .as_ref()
                    .is_some_and(|active| active.load(Ordering::Acquire))
            {
                return Ok(false);
            }
            if let Some(previous) = state.active.take() {
                previous.store(false, Ordering::Release);
            }
            state.path = None;
            let active = path.map(|_| Arc::new(AtomicBool::new(true)));
            state.active = active.clone();
            (state.watcher.take(), active)
        };
        // Dropping a watcher releases its watches on the blocking worker.
        drop(previous);
        let Some((path, active)) = path.zip(active) else {
            return Ok(false);
        };
        let opened = open(path, active.clone());
        let mut state = self.state[pane as usize]
            .lock()
            .map_err(|_| "dir watch state unavailable")?;
        if !state
            .active
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &active))
        {
            return Ok(false);
        }
        let watcher = match opened {
            Ok(watcher) => watcher,
            Err(error) => {
                active.store(false, Ordering::Release);
                state.active = None;
                return Err(error);
            }
        };
        if !active.load(Ordering::Acquire) {
            // A fatal native notification can arrive immediately after watch().
            state.active = None;
            drop(state);
            return Err("Directory watch stopped during registration.".into());
        }
        state.path = Some(path.to_owned());
        state.watcher = Some(watcher);
        Ok(true)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum WatchIssue {
    Rescan,
    Stopped,
}

fn watch_issue(target: &Path, result: &notify::Result<Event>) -> Option<WatchIssue> {
    match result {
        Ok(event) if event.need_rescan() => Some(WatchIssue::Rescan),
        Ok(event)
            if matches!(event.kind, EventKind::Remove(_))
                && event.paths.iter().any(|path| path == target) =>
        {
            // Notify reports a removed Windows watch root before retiring the watch.
            Some(WatchIssue::Stopped)
        }
        // Notify rearms before decoding and reports malformed data with a rescan.
        Err(error)
            if matches!(&error.kind, notify::ErrorKind::Io(source)
            if source.kind() == io::ErrorKind::InvalidData && source.raw_os_error().is_none()) =>
        {
            Some(WatchIssue::Rescan)
        }
        Err(_) => Some(WatchIssue::Stopped),
        Ok(_) => None,
    }
}

fn recover_watch(
    path: &str,
    issue: WatchIssue,
    pending_rename: &mut Option<String>,
    active: &AtomicBool,
) -> Option<DirChangedPayload> {
    let watch_failed = issue == WatchIssue::Stopped;
    let was_active = if watch_failed {
        active.swap(false, Ordering::AcqRel)
    } else {
        active.load(Ordering::Acquire)
    };
    if !was_active {
        return None;
    }
    // Old-name and new-name events cannot be paired across lost data.
    *pending_rename = None;
    Some(DirChangedPayload {
        path: path.to_owned(),
        rescan: true,
        watch_failed,
        ..DirChangedPayload::default()
    })
}

pub fn open_dir_watch(
    app_handle: AppHandle,
    path: &str,
    active: Arc<AtomicBool>,
) -> Result<RecommendedWatcher, String> {
    let target_path = path.to_string();
    let indexed_search = app_handle
        .try_state::<IndexedSearchHandle>()
        .map(|state| state.inner().clone());
    let mut pending_rename: Option<String> = None;
    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            if !active.load(Ordering::Acquire) {
                return;
            }
            let target = Path::new(&target_path);
            if let Some(issue) = watch_issue(target, &result) {
                let Some(payload) =
                    recover_watch(&target_path, issue, &mut pending_rename, &active)
                else {
                    return;
                };
                let watch_failed = payload.watch_failed;
                let _ = app_handle.emit("dir_changed", payload);
                if !watch_failed {
                    if let Some(index) = indexed_search.as_ref() {
                        if let Err(error) = index.queue_visited_folder(&target_path) {
                            eprintln!("[indexed-search] Could not queue a watcher rescan: {error}");
                        }
                    }
                } else {
                    if let Err(error) = &result {
                        eprintln!("[watch] Directory watch stopped: {error}");
                    }
                }
                return;
            }
            let Ok(event) = result else {
                return;
            };
            // Ignore access-only events to reduce noisy refreshes.
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            if let Some(index) = indexed_search.as_ref().filter(|index| index.is_enabled()) {
                let paths = indexed_watch_paths(target, &event);
                if !paths.is_empty() {
                    if let Err(error) =
                        index.queue_watched_paths(&paths, indexed_size_change(&event))
                    {
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
                        pending_rename = event_paths.first().cloned();
                        // A move out of the folder can arrive without a To event.
                    }
                    RenameMode::To => {
                        if let (Some(from), Some(to)) = (pending_rename.take(), event_paths.first())
                        {
                            let payload = DirRenamePayload {
                                path: target_path.clone(),
                                from: from.clone(),
                                to: to.clone(),
                                paths: vec![from, to.clone()],
                            };
                            let _ = app_handle.emit("dir_rename", payload);
                            return;
                        }
                    }
                    RenameMode::Both => {
                        pending_rename = None;
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
                writing: indexed_size_change(&event),
                ..DirChangedPayload::default()
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
    // The backend checks only the file size for generic and data modifications.
    if event.need_rescan()
        || !matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
        ) && !indexed_size_change(event)
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

fn indexed_size_change(event: &Event) -> bool {
    // notify's Windows backend emits Modify(Any) for FILE_ACTION_MODIFIED.
    matches!(
        event.kind,
        EventKind::Modify(ModifyKind::Any | ModifyKind::Data(_))
    )
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
        let write = Event::new(EventKind::Modify(ModifyKind::Any)).add_path(child.clone());
        assert!(indexed_size_change(&write));
        assert_eq!(
            indexed_watch_paths(parent, &write),
            [child.to_str().unwrap()]
        );
        let metadata = Event::new(EventKind::Modify(ModifyKind::Metadata(
            notify::event::MetadataKind::Any,
        )))
        .add_path(child);
        assert!(indexed_watch_paths(parent, &metadata).is_empty());
    }

    #[test]
    fn closing_the_bottom_watch_preserves_the_main_watch() {
        use crate::domain::filesystem::FilePane::{Bottom, Main};
        let handle = DirWatchHandle::default();
        for (pane, path) in [(Main, "upper"), (Bottom, "lower")] {
            assert!(handle
                .set_target(pane, Some(path), Some(1), false, |_, _| {
                    notify::recommended_watcher(|_| {}).map_err(|err| err.to_string())
                })
                .unwrap());
        }
        handle
            .set_target(Bottom, None, Some(2), false, |_, _| unreachable!())
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
            older.set_target(
                Default::default(),
                Some("slow"),
                Some(1),
                false,
                |_, active| {
                    opened.send(()).unwrap();
                    wait_for_release
                        .recv_timeout(Duration::from_secs(5))
                        .unwrap();
                    assert!(!active.load(Ordering::Acquire));
                    notify::recommended_watcher(|_| {}).map_err(|err| err.to_string())
                },
            )
        });
        wait_for_open.recv_timeout(Duration::from_secs(5)).unwrap();
        handle
            .set_target(
                Default::default(),
                Some("latest"),
                Some(3),
                false,
                |_, _| notify::recommended_watcher(|_| {}).map_err(|err| err.to_string()),
            )
            .unwrap();
        release.send(()).unwrap();
        assert!(!slow.join().unwrap().unwrap());
        handle
            .set_target(
                Default::default(),
                None,
                Some(2),
                false,
                |_, _| unreachable!(),
            )
            .unwrap();
        assert_eq!(
            handle.state[0].lock().unwrap().path.as_deref(),
            Some("latest")
        );

        handle
            .set_target(
                Default::default(),
                None,
                Some(5),
                false,
                |_, _| unreachable!(),
            )
            .unwrap();
        handle
            .set_target(
                Default::default(),
                Some("late start"),
                Some(4),
                false,
                |_, _| panic!("stale request opened a watcher"),
            )
            .unwrap();
        assert!(handle.state[0].lock().unwrap().watcher.is_none());
    }

    #[test]
    fn rescan_drops_pending_rename_without_stopping_the_watch() {
        let target = Path::new(r"C:\folder");
        let overflow = Ok(Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan));
        let active = AtomicBool::new(true);
        let mut pending = Some(r"C:\folder\old.txt".into());
        let issue = watch_issue(target, &overflow).unwrap();
        let payload =
            recover_watch(target.to_str().unwrap(), issue, &mut pending, &active).unwrap();
        assert!(pending.is_none());
        assert!(active.load(Ordering::Acquire));
        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            serde_json::json!({"path": target.to_str().unwrap(), "paths": [], "rescan": true}),
        );
        let malformed = Err(notify::Error::io(io::Error::new(
            io::ErrorKind::InvalidData,
            "record",
        )));
        assert_eq!(watch_issue(target, &malformed), Some(WatchIssue::Rescan));
    }

    #[test]
    fn fatal_errors_and_root_removal_stop_only_the_supplied_watch() {
        use notify::event::RemoveKind;
        let target = Path::new(r"C:\folder");
        let kind = EventKind::Remove(RemoveKind::Folder);
        let child_removed = Ok(Event::new(kind).add_path(target.join("child")));
        let root_removed = Ok(Event::new(kind).add_path(target.into()));
        let failure = Err(notify::Error::io(io::Error::from(
            io::ErrorKind::PermissionDenied,
        )));
        assert_eq!(watch_issue(target, &child_removed), None);
        for result in [root_removed, failure] {
            let active = AtomicBool::new(true);
            let mut pending = Some(r"C:\folder\old.txt".into());
            let issue = watch_issue(target, &result).unwrap();
            let payload =
                recover_watch(target.to_str().unwrap(), issue, &mut pending, &active).unwrap();
            assert!(pending.is_none());
            assert!(!active.load(Ordering::Acquire));
            assert_eq!(
                serde_json::to_value(payload).unwrap(),
                serde_json::json!({
                    "path": target.to_str().unwrap(), "paths": [], "rescan": true, "watchFailed": true
                }),
            );
            assert!(recover_watch(
                target.to_str().unwrap(),
                WatchIssue::Stopped,
                &mut pending,
                &active
            )
            .is_none());
        }
    }

    #[test]
    fn explicit_retry_rearms_the_same_path_and_retires_its_old_callback() {
        let handle = DirWatchHandle::default();
        let pane = crate::domain::filesystem::FilePane::Main;
        let open = |_: &str, _: Arc<AtomicBool>| {
            notify::recommended_watcher(|_| {}).map_err(|err| err.to_string())
        };
        assert!(handle
            .set_target(pane, Some("folder"), Some(1), false, open)
            .unwrap());
        let previous = handle.state[pane as usize]
            .lock()
            .unwrap()
            .active
            .clone()
            .unwrap();
        assert!(!handle
            .set_target(pane, Some("folder"), Some(2), false, |_, _| unreachable!())
            .unwrap());
        assert!(previous.load(Ordering::Acquire));
        assert!(handle
            .set_target(pane, Some("folder"), Some(3), true, open)
            .unwrap());
        assert!(!previous.load(Ordering::Acquire));
        let state = handle.state[pane as usize].lock().unwrap();
        assert!(state.active.as_ref().unwrap().load(Ordering::Acquire));
        assert_eq!(state.path.as_deref(), Some("folder"));
    }

    #[cfg(windows)]
    #[test]
    fn removing_a_real_watched_directory_reports_stopped() {
        let path = std::env::temp_dir().join(format!(
            "stratum-watch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        std::fs::create_dir(&path).unwrap();
        let (send, receive) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |event| {
            let _ = send.send(event);
        })
        .unwrap();
        watcher.watch(&path, RecursiveMode::NonRecursive).unwrap();
        let removed = std::fs::remove_dir(&path);
        let reported = removed
            .as_ref()
            .ok()
            .and_then(|()| receive.recv_timeout(Duration::from_secs(5)).ok());
        drop(watcher);
        if removed.is_err() {
            let _ = std::fs::remove_dir(&path);
        }
        removed.unwrap();
        assert_eq!(
            watch_issue(&path, &reported.expect("watch root removal")),
            Some(WatchIssue::Stopped)
        );
    }
}
