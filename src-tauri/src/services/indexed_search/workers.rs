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
    journal_tracking::{capture_checkpoint, AMBIGUOUS_PATH_MESSAGE, JOURNAL_PAUSED},
    scan,
    service::IndexedSearchHandle,
    state,
    work_queue::{normalize_path, Work, WorkQueue},
};

const VOLUME_CHECK_INTERVAL: Duration = Duration::from_secs(15);

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
            if status.service_status.state == IndexedSearchServiceState::Starting {
                // Keep early filesystem changes bounded and let the worker
                // check their mount before acting. They cannot schedule scans.
                queue.queue_watched_path(&drive, path);
                continue;
            }
            if !status
                .drive_statuses
                .get(&key)
                .is_some_and(|drive| drive.indexable)
            {
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

    pub(crate) fn queue_watched_paths(&self, paths: &[&str]) -> Result<(), String> {
        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.is_shutting_down() || !self.is_enabled() || self.catalog_error().is_some() {
            return Ok(());
        }
        let state = self.inner.state.lock().expect("indexed search state lock");
        for (drive, path) in paths.iter().filter_map(|path| normalize_path(path)) {
            if state.service_status.state == IndexedSearchServiceState::Starting
                || state
                    .volumes
                    .verified
                    .contains(&state::normalize_drive_key(&drive))
            {
                queue.queue_watched_path(&drive, path);
            }
        }
        drop(state);
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
                    if let Some(work) = queue.next() {
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
                    (queue, _) = self
                        .inner
                        .work_available
                        .wait_timeout(queue, next_volume_check.saturating_duration_since(now))
                        .expect("indexed search work queue");
                };
                match &work {
                    Work::CheckVolumes
                    | Work::ContinueJournal(_)
                    | Work::ReconcileWatched(_)
                    | Work::RefreshDriveCount(_)
                    | Work::BackfillSearch => {}
                    Work::Rebuild(drive) => {
                        let mut state = self.inner.state.lock().expect("indexed search state lock");
                        let has_snapshot = state
                            .volumes
                            .active_mount(drive)
                            .is_some_and(|mount| state.volumes.matching_snapshot(&mount).is_some());
                        let action = if has_snapshot {
                            "Rebuilding"
                        } else {
                            "Building"
                        };
                        state.update_service_status(
                            IndexedSearchServiceState::Scanning,
                            Some(format!("{action} index for {drive}")),
                        );
                        state.transition_drive_state(drive, IndexedDriveState::Scanning, None);
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
                Work::RefreshDriveCount(drive) => self.refresh_drive_count(&drive, generation),
                Work::ContinueJournal(drive) => self.continue_volume_journal(&drive, generation),
                Work::Rebuild(drive) => self.run_drive_rebuild(drive, generation),
                Work::Reconcile(paths) => self.run_reconcile(paths, generation),
                Work::ReconcileWatched(paths) => self.run_watched_paths(paths, generation),
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
        let checkpoint = (!JOURNAL_PAUSED).then(|| capture_checkpoint(&mount));
        let started = state::now_epoch_ms();
        let capture = scan::DriveScanCapture {
            drive_path: &mount.drive_path,
            volume_guid: &mount.guid,
            volume_id: &mount.identity,
            checkpoint: checkpoint
                .as_ref()
                .and_then(|probe| probe.as_ref().ok())
                .copied(),
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
                    last_scan_source: Some(summary.source.label().to_string()),
                    last_scan_completed_at: Some(state::now_epoch_ms().max(started)),
                    volume_id: Some(mount.identity.clone()),
                    journal_checkpoint: capture.checkpoint,
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
            if scanned.is_err() {
                queue.queue_rebuild(drive);
            }
            return;
        }

        match scanned {
            Ok(summary) => {
                status.set_drive_summary(
                    &drive,
                    Some(summary.entries_indexed as u64),
                    Some(summary.source.label().to_string()),
                );
                if JOURNAL_PAUSED {
                    status.mark_saved_volume_verified(&mount);
                } else if capture.checkpoint.is_some() {
                    if status.volumes.verified.contains(&mount.key()) {
                        status.mark_volume_verified(&mount, None);
                    } else {
                        status.transition_drive_state(
                            &drive,
                            IndexedDriveState::Stale,
                            Some("Checking changes that occurred during the scan.".to_string()),
                        );
                    }
                    queue.queue_volume_check();
                } else {
                    let warning = checkpoint.and_then(Result::err).map(|error| {
                        format!(
                            "Change journal unavailable. Showing the last complete index. {error}"
                        )
                    });
                    status.volumes.journal_rebuilds.remove(&mount.key());
                    status.mark_volume_verified(&mount, warning);
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
            for (drive, path) in paths.iter().filter_map(|path| normalize_path(path)) {
                if queue.queue_path(drive.clone(), path) {
                    self.transition_drive_state(&drive, IndexedDriveState::Queued, None);
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

    fn run_watched_paths(&self, paths: Vec<String>, generation: u64) {
        #[cfg(not(windows))]
        let _ = (paths, generation);
        #[cfg(windows)]
        {
            let catalog = self.catalog().expect("queued work has a catalog");
            let mut changed = false;
            for path in paths {
                if self.should_cancel_work(generation) {
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
                match super::watched_paths::refresh(catalog, &mount, &path, &|| {
                    self.should_cancel_work(generation)
                }) {
                    Ok(committed) => changed |= committed,
                    Err(error) => {
                        eprintln!("[indexed-search] Folder notification update failed: {error}")
                    }
                }
            }
            if changed {
                self.bump_catalog_revision();
            }
        }
    }
}
