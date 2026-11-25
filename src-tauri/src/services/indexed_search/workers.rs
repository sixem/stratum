// Run catalog writes on one worker so queued changes cannot occupy a thread
// each while waiting for a scan. The queue lock covers admission and status
// transitions, but is released during all filesystem and database work.
use std::{
    collections::BTreeMap,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{
    GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN,
};

use crate::domain::indexed_search::{IndexedDriveState, IndexedSearchServiceState};

use super::{
    catalog::DriveCatalogSnapshot,
    journal_tracking::{capture_checkpoint, AMBIGUOUS_PATH_MESSAGE},
    scan,
    service::IndexedSearchHandle,
    state,
    work_queue::{normalize_path, WatchedPath, Work, WorkQueue},
};

const VOLUME_CHECK_INTERVAL: Duration = Duration::from_secs(15);
const SIZE_BACKFILL_YIELD_INTERVAL: Duration = Duration::from_millis(50);
#[cfg(windows)]
const SIZE_BACKFILL_PUBLISH_INTERVAL: Duration = Duration::from_secs(5);

impl IndexedSearchHandle {
    pub fn request_drive_rebuild(&self, drive_path: String) -> Result<bool, String> {
        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.is_shutting_down() || !self.is_enabled() {
            return Ok(false);
        }
        if let Some(error) = self.catalog_error() {
            self.mark_catalog_unavailable();
            return Err(error.to_owned());
        }
        if self.catalog().is_none() {
            return Ok(false);
        }

        let drive = {
            let state = self.inner.state.lock().expect("indexed search state lock");
            let Some(status) = state
                .drive_statuses
                .get(&state::normalize_drive_key(&drive_path))
            else {
                return Err("Indexed-search drive not found.".to_string());
            };
            if !status.indexable {
                return Err(
                    "This drive is not indexable in the current indexed-search scope.".to_string(),
                );
            }
            status.drive_path.clone()
        };

        let queued = if queue.active_drive.as_ref() == Some(&drive) {
            false
        } else {
            queue.queue_rebuild(drive.clone())
        };
        if queued {
            self.transition_drive_state(&drive, IndexedDriveState::Queued, None);
        }
        self.start_worker(&mut queue)?;
        Ok(queued)
    }

    pub fn queue_reconcile_paths(&self, paths: Vec<String>) -> Result<(), String> {
        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.is_shutting_down() || !self.is_enabled() || self.catalog_error().is_some() {
            return Ok(());
        }

        let mut status = self.inner.state.lock().expect("indexed search state lock");
        for (drive, path) in paths.iter().filter_map(|path| normalize_path(path)) {
            let key = state::normalize_drive_key(&drive);
            if !status.includes_drive(&key) {
                continue;
            }
            if status.service_status.state == IndexedSearchServiceState::Starting {
                // Keep early filesystem changes bounded and let the worker
                // check their mount before acting. They cannot schedule scans.
                queue.queue_watched_path(&drive, path, false);
                continue;
            }
            if !status
                .drive_statuses
                .get(&key)
                .is_some_and(|drive| drive.indexable)
            {
                continue;
            }

            if status.tracks_changes(&key) {
                // Replay this operation promptly through the same writer that
                // handles external changes and advances the saved cursor.
                queue.queue_journal_continuation(drive);
                continue;
            }

            if queue.queue_path(drive.clone(), path) && queue.active_drive.as_ref() != Some(&drive)
            {
                status.transition_drive_state(&drive, IndexedDriveState::Queued, None);
            }
        }
        drop(status);
        self.start_worker(&mut queue)
    }

    pub(crate) fn queue_watched_paths(
        &self,
        paths: &[&str],
        size_only: bool,
    ) -> Result<(), String> {
        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.is_shutting_down() || !self.is_enabled() || self.catalog_error().is_some() {
            return Ok(());
        }
        let state = self.inner.state.lock().expect("indexed search state lock");
        let now = Instant::now();
        let mut wake_worker = false;
        for (drive, path) in paths.iter().filter_map(|path| normalize_path(path)) {
            let key = state::normalize_drive_key(&drive);
            if !state.includes_drive(&key) {
                continue;
            }
            if state.has_verified_journal(&key) {
                wake_worker |= queue.queue_journal_hint(drive, now);
                continue;
            }
            if state.service_status.state == IndexedSearchServiceState::Starting
                || state.volumes.verified.contains(&key)
            {
                queue.queue_watched_path(&drive, path, size_only);
                wake_worker = true;
            }
        }
        drop(state);
        if wake_worker {
            self.start_worker(&mut queue)?;
        }
        Ok(())
    }

    pub(crate) fn nudge_indexed_search(&self) -> Result<(), String> {
        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.is_shutting_down() || !self.is_enabled() || self.catalog_error().is_some() {
            return Ok(());
        }
        let state = self.inner.state.lock().expect("indexed search state lock");
        let now = Instant::now();
        let mut wake_worker = false;
        for mount in state
            .volumes
            .verified
            .iter()
            .filter(|key| state.has_verified_journal(key))
            .filter_map(|key| state.volumes.mounted.get(key))
        {
            wake_worker |= queue.queue_journal_hint(mount.drive_path.clone(), now);
        }
        drop(state);
        if wake_worker {
            self.start_worker(&mut queue)?;
        }
        Ok(())
    }

    pub(crate) fn queue_visited_folder(&self, folder: &str) -> Result<(), String> {
        let Some((drive, folder)) = normalize_path(folder) else {
            return Ok(());
        };
        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.is_shutting_down() || !self.is_enabled() || self.catalog_error().is_some() {
            return Ok(());
        }
        let state = self.inner.state.lock().expect("indexed search state lock");
        let key = state::normalize_drive_key(&drive);
        if !state.includes_drive(&key)
            || (state.service_status.state != IndexedSearchServiceState::Starting
                && !state.uses_folder_reconciliation(&key))
        {
            return Ok(());
        }
        drop(state);
        queue.queue_visited_folder(&drive, folder);
        self.start_worker(&mut queue)
    }

    pub(super) fn start_worker(&self, queue: &mut WorkQueue) -> Result<(), String> {
        if queue.running {
            self.inner.work_available.notify_one();
            return Ok(());
        }
        if queue.is_empty() {
            return Ok(());
        }

        // The worker cannot take its first item until the caller unlocks.
        let handle = self.clone();
        match std::thread::Builder::new()
            .name("indexed-search-writer".to_string())
            .spawn(move || handle.run_worker())
        {
            Ok(thread) => {
                queue.running = true;
                queue.thread = Some(thread);
                Ok(())
            }
            Err(error) => {
                let message = format!("Failed to start indexed-search worker: {error}");
                self.set_service_state(IndexedSearchServiceState::Error, Some(message.clone()));
                Err(message)
            }
        }
    }

    fn run_worker(&self) {
        // This dedicated thread does the filesystem and SQLite work. Windows
        // background mode lets foreground work take priority for CPU and I/O.
        #[cfg(target_os = "windows")]
        if let Err(error) = unsafe {
            // The pseudo-handle refers to this thread and does not need closing.
            SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN)
        } {
            eprintln!("[indexed-search] could not enter background processing mode: {error}");
        }
        if !self.initialize_catalog() {
            let mut queue = self
                .inner
                .work_queue
                .lock()
                .expect("indexed search work queue");
            if self.is_enabled() && !self.is_shutting_down() {
                self.mark_catalog_unavailable();
            }
            queue.running = false;
            return;
        }

        let mut next_volume_check = Instant::now() + VOLUME_CHECK_INTERVAL;
        let mut next_size_backfill = Instant::now();
        #[cfg(windows)]
        let mut size_changes_waiting = false;
        #[cfg(windows)]
        let mut next_size_publish = Instant::now() + SIZE_BACKFILL_PUBLISH_INTERVAL;
        loop {
            let (work, generation) = {
                let mut queue = self
                    .inner
                    .work_queue
                    .lock()
                    .expect("indexed search work queue");
                let work = loop {
                    if self.is_shutting_down() || !self.is_enabled() {
                        queue.running = false;
                        return;
                    }
                    let now = Instant::now();
                    if now >= next_volume_check {
                        queue.queue_volume_check();
                    }
                    if let Some(work) = queue.next_ready(now, now >= next_size_backfill) {
                        break work;
                    }
                    {
                        let mut status =
                            self.inner.state.lock().expect("indexed search state lock");
                        if matches!(
                            status.service_status.state,
                            IndexedSearchServiceState::Starting
                                | IndexedSearchServiceState::Scanning
                        ) {
                            status.update_service_status(IndexedSearchServiceState::Idle, None);
                        }
                    }
                    let wake_at = if queue.has_size_backfill() {
                        next_volume_check.min(next_size_backfill)
                    } else {
                        next_volume_check
                    };
                    let wake_at = queue
                        .next_journal_hint()
                        .map_or(wake_at, |due| wake_at.min(due));
                    (queue, _) = self
                        .inner
                        .work_available
                        .wait_timeout(queue, wake_at.saturating_duration_since(now))
                        .expect("indexed search work queue");
                };
                match &work {
                    Work::CheckVolumes
                    | Work::ContinueJournal(_)
                    | Work::ReconcileWatched(_)
                    | Work::ReconcileVisitedFolder(_)
                    | Work::RefreshDriveCount(_)
                    | Work::BackfillSearch => {}
                    Work::BackfillFileSizes => {
                        let mut state = self.inner.state.lock().expect("indexed search state lock");
                        if matches!(
                            state.service_status.state,
                            IndexedSearchServiceState::Starting
                                | IndexedSearchServiceState::Scanning
                        ) {
                            state.update_service_status(IndexedSearchServiceState::Idle, None);
                        }
                    }
                    Work::Rebuild(drive) => {
                        let mut state = self.inner.state.lock().expect("indexed search state lock");
                        let existing_index = state
                            .volumes
                            .active_mount(drive)
                            .and_then(|mount| state.volumes.matching_snapshot(&mount));
                        let action = if existing_index.is_some() {
                            "Rebuilding"
                        } else {
                            "Building"
                        };
                        let message = existing_index.map(|snapshot| {
                            if snapshot.journal_checkpoint.is_none() {
                                "Establishing change tracking. Saved results stay available."
                            } else {
                                "Refreshing the index. Saved results stay available."
                            }
                            .to_string()
                        });
                        state.update_service_status(
                            IndexedSearchServiceState::Scanning,
                            Some(format!("{action} index for {drive}")),
                        );
                        state.transition_drive_state(drive, IndexedDriveState::Scanning, message);
                    }
                    Work::Reconcile(_) => self.set_service_state(
                        IndexedSearchServiceState::Scanning,
                        Some("Updating search index".to_string()),
                    ),
                }
                (work, self.inner.work_generation.load(Ordering::SeqCst))
            };

            match work {
                Work::CheckVolumes => {
                    self.run_volume_check(generation);
                    next_volume_check = Instant::now() + VOLUME_CHECK_INTERVAL;
                }
                Work::BackfillSearch => self.run_search_backfill(generation),
                Work::BackfillFileSizes => {
                    #[cfg(windows)]
                    {
                        let (changed, reschedule) = self.run_size_backfill(generation);
                        size_changes_waiting |= changed;
                        // Each batch is searchable immediately. Coalesce cache
                        // invalidations and visible result refreshes across batches.
                        let now = Instant::now();
                        if size_changes_waiting && (!reschedule || now >= next_size_publish) {
                            self.bump_catalog_revision();
                            size_changes_waiting = false;
                            next_size_publish = now + SIZE_BACKFILL_PUBLISH_INTERVAL;
                        }
                    }
                    next_size_backfill = Instant::now() + SIZE_BACKFILL_YIELD_INTERVAL;
                }
                Work::RefreshDriveCount(drive) => self.refresh_drive_count(&drive, generation),
                Work::ContinueJournal(drive) => self.continue_volume_journal(&drive, generation),
                Work::Rebuild(drive) => self.run_drive_rebuild(drive, generation),
                Work::Reconcile(paths) => self.run_reconcile(paths, generation),
                Work::ReconcileWatched(paths) => self.run_watched_paths(paths, generation),
                Work::ReconcileVisitedFolder(folder) => {
                    self.run_visited_folder(&folder, generation)
                }
            }
        }
    }

    fn refresh_drive_count(&self, drive: &str, generation: u64) {
        let (mount, snapshot) = {
            let state = self.inner.state.lock().expect("indexed search state lock");
            let Some(mount) = state.volumes.active_mount(drive) else {
                return;
            };
            if !state.volumes.verified.contains(&mount.key()) {
                return;
            }
            let Some(snapshot) = state.volumes.matching_snapshot(&mount) else {
                return;
            };
            (mount, snapshot.clone())
        };
        let catalog = self.catalog().expect("queued work has a catalog");
        let count = match catalog.refresh_ready_drive_count(&snapshot) {
            Ok(Some(count)) => count,
            Ok(None) => return,
            Err(error) => {
                eprintln!("[indexed-search] {error}");
                return;
            }
        };
        let mut state = self.inner.state.lock().expect("indexed search state lock");
        if self.should_cancel_work(generation) || !state.volumes.verified.contains(&mount.key()) {
            return;
        }
        if let Some(current) = state.volumes.snapshots.get_mut(&mount.key()) {
            if current.volume_id == snapshot.volume_id
                && current.last_scan_completed_at == snapshot.last_scan_completed_at
                && current.entry_count != Some(count)
            {
                current.entry_count = Some(count);
                state.set_drive_summary(drive, Some(count as u64), snapshot.last_scan_source);
            }
        }
    }

    fn run_search_backfill(&self, generation: u64) {
        let catalog = self.catalog().expect("queued work has a catalog");
        let result = catalog
            .search_index_needs_backfill()
            .and_then(|needs_backfill| {
                if needs_backfill {
                    {
                        let _queue = self
                            .inner
                            .work_queue
                            .lock()
                            .expect("indexed search work queue");
                        if self.should_cancel_work(generation) {
                            return Ok(None);
                        }
                        self.set_service_state(
                            IndexedSearchServiceState::Scanning,
                            Some("Preparing search index".to_string()),
                        );
                    }
                    catalog
                        .backfill_search_index_step(&|| self.should_cancel_work(generation))
                        .map(Some)
                } else {
                    Ok(None)
                }
            });
        match result {
            Ok(Some(true)) => self.bump_catalog_revision(),
            Ok(Some(false)) => {
                let mut queue = self
                    .inner
                    .work_queue
                    .lock()
                    .expect("indexed search work queue");
                if !self.should_cancel_work(generation) {
                    queue.queue_search_backfill();
                }
            }
            Ok(None) => {}
            Err(error) => {
                let _queue = self
                    .inner
                    .work_queue
                    .lock()
                    .expect("indexed search work queue");
                if !self.should_cancel_work(generation) {
                    let message = format!("Indexed-search migration failed: {error}");
                    eprintln!("{message}");
                    self.set_service_state(IndexedSearchServiceState::Error, Some(message));
                }
            }
        }
    }

    #[cfg(windows)]
    fn run_size_backfill(&self, generation: u64) -> (bool, bool) {
        let mounts = self
            .inner
            .state
            .lock()
            .expect("indexed search state lock")
            .volumes
            .verified_mounts();
        let catalog = self.catalog().expect("queued work has a catalog");
        let step =
            catalog.backfill_file_sizes_step(&mounts, &|| self.should_cancel_work(generation));
        match step {
            Ok(step) => {
                if step.reschedule {
                    let mut queue = self
                        .inner
                        .work_queue
                        .lock()
                        .expect("indexed search work queue");
                    if !self.should_cancel_work(generation) {
                        queue.queue_size_backfill();
                    }
                }
                (step.changed, step.reschedule)
            }
            Err(error) => {
                eprintln!("[indexed-search] {error}");
                (false, false)
            }
        }
    }

    fn run_drive_rebuild(&self, drive: String, generation: u64) {
        let catalog = self.catalog().expect("queued work has a catalog");
        let mount = self
            .inner
            .state
            .lock()
            .expect("indexed search state lock")
            .volumes
            .active_mount(&drive);
        let Some(mount) = mount else {
            self.inner
                .work_queue
                .lock()
                .expect("indexed search work queue")
                .active_drive = None;
            return;
        };
        let checkpoint = capture_checkpoint(&mount);
        let started = state::now_epoch_ms();
        let capture = scan::DriveScanCapture {
            drive_path: &mount.drive_path,
            volume_guid: &mount.guid,
            volume_id: &mount.identity,
            checkpoint: checkpoint.as_ref().ok().copied(),
            excluded_directory: catalog.directory(),
        };
        let scanned = scan::scan_drive_into_catalog(
            catalog,
            &capture,
            &|| self.should_cancel_work(generation),
            &|| mount.verify(),
        );

        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        queue.active_drive = None;
        let mut status = self.inner.state.lock().expect("indexed search state lock");
        if let Ok(summary) = &scanned {
            status.volumes.snapshots.insert(
                mount.key(),
                DriveCatalogSnapshot {
                    drive_path: drive.clone(),
                    entry_count: Some(summary.entries_indexed),
                    last_scan_source: Some(scan::FILESYSTEM_SCAN_SOURCE.to_string()),
                    last_scan_completed_at: Some(state::now_epoch_ms().max(started)),
                    volume_id: Some(mount.identity.clone()),
                    journal_checkpoint: summary.checkpoint,
                    pending_renames: false,
                },
            );
            self.bump_catalog_revision();
        }
        if self.is_shutting_down() {
            return;
        }
        if self.should_cancel_work(generation) {
            // A disable/re-enable cycle cannot revive the old worker's scan.
            // Queue another attempt so the cancelled work isn't lost.
            if scanned.is_err() && status.includes_drive(&mount.key()) {
                queue.queue_rebuild(drive);
            }
            return;
        }

        match scanned {
            Ok(summary) => {
                status.set_drive_summary(
                    &drive,
                    Some(summary.entries_indexed as u64),
                    Some(scan::FILESYSTEM_SCAN_SOURCE.to_string()),
                );
                if summary.checkpoint.is_some() {
                    status.volumes.unavailable_journals.remove(&mount.key());
                    status.mark_saved_volume_verified(
                        &mount,
                        Some("Checking changes made during the scan.".to_string()),
                    );
                    queue.queue_volume_check();
                } else {
                    if checkpoint.is_err() {
                        status.volumes.unavailable_journals.insert(mount.key());
                    } else {
                        status.volumes.unavailable_journals.remove(&mount.key());
                    }
                    let warning = checkpoint.err().map(|error| {
                        format!("Live updates unavailable. Showing saved results. {error}")
                    });
                    status.volumes.journal_rebuilds.remove(&mount.key());
                    status.mark_saved_volume_verified(&mount, warning);
                }
            }
            Err(error) => status.transition_drive_state(
                &drive,
                IndexedDriveState::Error,
                Some(format!("Indexed-search scan failed: {error}")),
            ),
        }
    }

    fn run_reconcile(&self, paths: Vec<String>, generation: u64) {
        let catalog = self.catalog().expect("queued work has a catalog");
        let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (drive, path) in paths.iter().filter_map(|path| normalize_path(path)) {
            grouped.entry(drive).or_default().push(path);
        }
        let mut last_error = None;
        for (drive, drive_paths) in grouped {
            let mount = {
                let state = self.inner.state.lock().expect("indexed search state lock");
                let key = state::normalize_drive_key(&drive);
                if !state.volumes.verified.contains(&key) {
                    continue;
                }
                state.volumes.active_mount(&drive)
            };
            let Some(mount) = mount else {
                continue;
            };
            match super::reconcile::reconcile_paths(catalog, &mount, drive_paths, &|| {
                self.should_cancel_work(generation)
            }) {
                Ok(super::reconcile::ReconcileOutcome::Committed {
                    changed_paths: true,
                    ..
                }) => {
                    self.bump_catalog_revision();
                    self.touch_drive_status(&drive);
                }
                Ok(
                    super::reconcile::ReconcileOutcome::Committed {
                        changed_paths: false,
                        ..
                    }
                    | super::reconcile::ReconcileOutcome::Unchanged,
                ) => {}
                Ok(super::reconcile::ReconcileOutcome::Cancelled) => break,
                Ok(super::reconcile::ReconcileOutcome::NeedsRebuild) => {
                    self.require_volume_rebuild(&mount, generation, AMBIGUOUS_PATH_MESSAGE);
                }
                Err(error) => last_error = Some(error),
            }
        }

        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.is_shutting_down() {
            return;
        }
        if self.should_cancel_work(generation) {
            let mut state = self.inner.state.lock().expect("indexed search state lock");
            for (drive, path) in paths.iter().filter_map(|path| normalize_path(path)) {
                if state.includes_drive(&state::normalize_drive_key(&drive))
                    && queue.queue_path(drive.clone(), path)
                {
                    state.transition_drive_state(&drive, IndexedDriveState::Queued, None);
                }
            }
            return;
        }

        if let Some(error) = last_error {
            queue.queue_volume_check();
            self.set_service_state(
                IndexedSearchServiceState::Error,
                Some(format!("Indexed-search update failed: {error}")),
            );
        }
    }

    fn run_watched_paths(&self, paths: Vec<WatchedPath>, generation: u64) {
        #[cfg(not(windows))]
        let _ = (paths, generation);
        #[cfg(windows)]
        {
            let catalog = self.catalog().expect("queued work has a catalog");
            let mut changed = false;
            // A scope change can interrupt a mixed-drive batch. Keep pending
            // notifications for drives that remain included.
            for (index, WatchedPath { path, size_only }) in paths.iter().enumerate() {
                if self.should_cancel_work(generation) {
                    self.requeue_watched_paths(&paths[index..]);
                    break;
                }
                let mount = {
                    let state = self.inner.state.lock().expect("indexed search state lock");
                    let drive = &path[..3];
                    let key = state::normalize_drive_key(drive);
                    if !state.volumes.verified.contains(&key) {
                        continue;
                    }
                    state.volumes.active_mount(drive)
                };
                let Some(mount) = mount else {
                    continue;
                };
                let cancelled = || self.should_cancel_work(generation);
                let result = if *size_only {
                    super::watched_paths::refresh_file_size(catalog, &mount, path, &cancelled)
                } else {
                    super::watched_paths::refresh(catalog, &mount, path, &cancelled)
                };
                match result {
                    Ok(committed) => changed |= committed,
                    Err(error) => {
                        eprintln!("[indexed-search] Folder notification update failed: {error}")
                    }
                }
                if self.should_cancel_work(generation) {
                    // Reprocessing the interrupted notification is harmless
                    // if it committed just before the scope change.
                    self.requeue_watched_paths(&paths[index..]);
                    break;
                }
            }
            if changed {
                self.bump_catalog_revision();
            }
        }
    }

    #[cfg(windows)]
    fn requeue_watched_paths(&self, paths: &[WatchedPath]) {
        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.is_shutting_down() {
            return;
        }
        let state = self.inner.state.lock().expect("indexed search state lock");
        for WatchedPath { path, size_only } in paths {
            let drive = &path[..3];
            if state.includes_drive(&state::normalize_drive_key(drive)) {
                queue.queue_watched_path(drive, path.clone(), *size_only);
            }
        }
    }

    fn run_visited_folder(&self, folder: &str, generation: u64) {
        #[cfg(not(windows))]
        let _ = (folder, generation);
        #[cfg(windows)]
        {
            let drive = &folder[..3];
            let mount = {
                let state = self.inner.state.lock().expect("indexed search state lock");
                if !state.uses_folder_reconciliation(&state::normalize_drive_key(drive)) {
                    return;
                }
                state.volumes.active_mount(drive)
            };
            let Some(mount) = mount else {
                return;
            };
            let catalog = self.catalog().expect("queued work has a catalog");
            match super::watched_paths::refresh_visited_folder(catalog, &mount, folder, &|| {
                self.should_cancel_work(generation)
            }) {
                Ok((true, entry_count)) => {
                    self.bump_catalog_revision();
                    if let Some(count) = entry_count {
                        let mut state = self.inner.state.lock().expect("indexed search state lock");
                        if let Some(snapshot) = state.volumes.snapshots.get_mut(&mount.key()) {
                            snapshot.entry_count = Some(count);
                            let source = snapshot.last_scan_source.clone();
                            state.set_drive_summary(drive, Some(count as u64), source);
                        }
                    }
                }
                Ok((false, _)) => {}
                Err(error) => eprintln!("[indexed-search] Visited folder update failed: {error}"),
            }
            if self.should_cancel_work(generation) && !self.is_shutting_down() {
                let mut queue = self
                    .inner
                    .work_queue
                    .lock()
                    .expect("indexed search work queue");
                let state = self.inner.state.lock().expect("indexed search state lock");
                if state.includes_drive(&mount.key()) {
                    queue.queue_visited_folder(drive, folder.to_owned());
                }
            }
        }
    }
}
