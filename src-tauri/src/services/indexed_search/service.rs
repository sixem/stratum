// Indexed-search lifecycle shell.
//
// This file owns construction, enable/disable state, shutdown state, and the
// small mutation helpers shared by worker and reconcile modules. Backend scans,
// path reconciliation, and query caching live beside it in focused modules.
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
};

use tauri::AppHandle;

use crate::domain::indexed_search::{
    IndexedDriveState, IndexedDriveStatus, IndexedSearchServiceState, IndexedSearchServiceStatus,
};

use super::{catalog, profile_catalog, query_cache::QueryCache, state, work_queue::WorkQueue};

#[derive(Clone)]
pub struct IndexedSearchHandle {
    pub(super) inner: Arc<IndexedSearchInner>,
}

pub(super) struct IndexedSearchInner {
    pub(super) state: Mutex<state::IndexedSearchState>,
    catalog_path: Result<PathBuf, String>,
    pub(super) catalog: OnceLock<Result<catalog::IndexedCatalogStore, String>>,
    pub(super) work_queue: Mutex<WorkQueue>,
    pub(super) work_available: Condvar,
    pub(super) query_cache: Mutex<QueryCache>,
    pub(super) catalog_revision: AtomicU64,
    pub(super) enabled: AtomicBool,
    pub(super) work_generation: AtomicU64,
    pub(super) shutting_down: AtomicBool,
}

impl IndexedSearchHandle {
    pub fn init(app_handle: AppHandle) -> Self {
        Self::new(profile_catalog::path_for_app(&app_handle))
    }

    fn new(catalog_path: Result<PathBuf, String>) -> Self {
        let mut state = state::IndexedSearchState::new();
        state.update_service_status(IndexedSearchServiceState::Disabled, None);
        Self {
            inner: Arc::new(IndexedSearchInner {
                state: Mutex::new(state),
                catalog_path,
                catalog: OnceLock::new(),
                work_queue: Mutex::new(WorkQueue::default()),
                work_available: Condvar::new(),
                query_cache: Mutex::new(QueryCache::new()),
                catalog_revision: AtomicU64::new(0),
                enabled: AtomicBool::new(false),
                work_generation: AtomicU64::new(0),
                shutting_down: AtomicBool::new(false),
            }),
        }
    }

    pub(super) fn initialize_catalog(&self) -> bool {
        self.inner
            .catalog
            .get_or_init(|| {
                // Open and load before any mount can be scheduled for a scan.
                // No state or queue locks cover these blocking disk reads.
                let store = profile_catalog::open(self.inner.catalog_path.clone()?)?;
                let snapshots = store.load_ready_drive_snapshots()?;
                self.inner
                    .state
                    .lock()
                    .expect("indexed search state lock")
                    .volumes
                    .load_snapshots(snapshots);
                Ok(store)
            })
            .is_ok()
    }

    pub fn service_status(&self) -> IndexedSearchServiceStatus {
        let guard = self.inner.state.lock().expect("indexed search state lock");
        let mut status = guard.service_status.clone();
        status.catalog_revision = self.catalog_revision();
        if self.is_enabled() {
            status.searchable_drive_count = guard.volumes.verified.len();
        }
        status
    }

    pub fn set_enabled(&self, enabled: bool) {
        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.is_shutting_down() {
            return;
        }

        if self.inner.enabled.swap(enabled, Ordering::SeqCst) == enabled {
            return;
        }
        self.inner.work_generation.fetch_add(1, Ordering::SeqCst);

        if enabled {
            if self.catalog_error().is_some() {
                self.mark_catalog_unavailable();
                return;
            }

            {
                let mut state = self.inner.state.lock().expect("indexed search state lock");
                state.volumes.verified.clear();
                state.volumes.journal_rebuilds.clear();
                for status in state.drive_statuses.values_mut() {
                    if status.indexable && status.state == IndexedDriveState::Error {
                        status.state = IndexedDriveState::Queued;
                    }
                }
            }
            queue.queue_volume_check();
            queue.queue_search_backfill();
            self.bump_catalog_revision();
            self.set_service_state(
                IndexedSearchServiceState::Starting,
                Some("Checking saved indexes".to_string()),
            );
            let _ = self.start_worker(&mut queue);
            return;
        }

        self.bump_catalog_revision();
        self.reset_disabled_drive_statuses();
        self.set_service_state(IndexedSearchServiceState::Disabled, None);
        self.inner.work_available.notify_one();
    }

    pub fn shutdown(&self) {
        let thread = {
            let mut queue = self
                .inner
                .work_queue
                .lock()
                .expect("indexed search work queue");
            self.inner.shutting_down.store(true, Ordering::SeqCst);
            self.inner.work_available.notify_one();
            queue.thread.take()
        };
        // Do not hold the queue lock while the cancelled worker unwinds.
        if let Some(thread) = thread {
            if thread.join().is_err() {
                eprintln!("[indexed-search] indexing worker panicked");
            }
        }
    }

    pub fn drive_statuses(&self) -> Vec<IndexedDriveStatus> {
        if !self.is_enabled() {
            return Vec::new();
        }

        let guard = self.inner.state.lock().expect("indexed search state lock");
        guard.drive_statuses_snapshot()
    }

    pub(super) fn set_service_state(
        &self,
        next_state: IndexedSearchServiceState,
        activity_label: Option<String>,
    ) {
        let mut guard = self.inner.state.lock().expect("indexed search state lock");
        guard.update_service_status(next_state, activity_label);
    }

    pub(super) fn transition_drive_state(
        &self,
        drive_path: &str,
        next_state: IndexedDriveState,
        message: Option<String>,
    ) {
        let mut guard = self.inner.state.lock().expect("indexed search state lock");
        guard.transition_drive_state(drive_path, next_state, message);
    }

    pub(super) fn touch_drive_status(&self, drive_path: &str) {
        let mut guard = self.inner.state.lock().expect("indexed search state lock");
        guard.touch_drive(drive_path);
    }

    pub(super) fn is_shutting_down(&self) -> bool {
        self.inner.shutting_down.load(Ordering::SeqCst)
    }

    pub(in crate::services) fn is_enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::SeqCst)
    }

    pub(super) fn should_cancel_work(&self, generation: u64) -> bool {
        self.is_shutting_down()
            || !self.is_enabled()
            || generation != self.inner.work_generation.load(Ordering::SeqCst)
    }

    pub(super) fn catalog(&self) -> Option<&catalog::IndexedCatalogStore> {
        self.inner.catalog.get()?.as_ref().ok()
    }

    pub(super) fn catalog_error(&self) -> Option<&str> {
        self.inner.catalog.get()?.as_ref().err().map(String::as_str)
    }

    pub(super) fn mark_catalog_unavailable(&self) {
        let reason = self
            .catalog_error()
            .unwrap_or("Indexed-search catalog is unavailable.");
        let drive_message = format!("Catalog initialization failed: {reason}");
        let activity_label = Some(format!("Indexed-search catalog unavailable: {reason}"));

        let mut guard = self.inner.state.lock().expect("indexed search state lock");
        guard.mark_indexable_drives_error(&drive_message);
        guard.update_service_status(IndexedSearchServiceState::Error, activity_label);
    }

    fn reset_disabled_drive_statuses(&self) {
        let mut guard = self.inner.state.lock().expect("indexed search state lock");
        for status in guard.drive_statuses.values_mut() {
            if !status.indexable {
                continue;
            }

            if status.state == IndexedDriveState::Scanning {
                status.state = IndexedDriveState::Queued;
            }

            status.message = None;
            status.last_updated_at = state::now_epoch_ms();
        }
    }
}

pub fn catalog_path_for_app(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    profile_catalog::path_for_app(app_handle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::indexed_search::IndexedPathQuery;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let directory = std::env::temp_dir().join(format!(
                "stratum-deferred-catalog-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
            ));
            fs::create_dir(&directory).unwrap();
            Self(directory)
        }

        fn path(&self) -> PathBuf {
            self.0.join("catalog-v2.db")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn query() -> IndexedPathQuery {
        IndexedPathQuery {
            query: "example".into(),
            limit: Some(10),
        }
    }

    #[test]
    fn deferred_catalog_opens_and_installs_complete_snapshots_before_it_is_used() {
        let fixture = Fixture::new();
        let handle = IndexedSearchHandle::new(Ok(fixture.path()));
        assert!(!fixture.path().exists());
        assert!(handle.catalog().is_none());

        let catalog = catalog::IndexedCatalogStore::open(fixture.path()).unwrap();
        let drive = r"C:\";
        catalog
            .begin_drive_refresh(drive)
            .unwrap()
            .finish_drive_refresh(drive, "Filesystem scan", 1, "volume-id", None, || Ok(()))
            .unwrap();
        handle.inner.enabled.store(true, Ordering::SeqCst);
        assert!(handle.query_paths(query()).unwrap().is_empty());
        assert!(handle.initialize_catalog());
        assert!(handle.catalog().is_some());
        let state = handle.inner.state.lock().unwrap();
        assert!(
            state.volumes.snapshots[&state::normalize_drive_key(drive)]
                .volume_id
                .as_deref()
                == Some("volume-id")
        );
        assert!(state.volumes.verified.is_empty());
    }

    #[test]
    fn deferred_catalog_read_failure_is_not_an_empty_starting_catalog() {
        let fixture = Fixture::new();
        fs::write(fixture.path(), b"not a catalog".repeat(32)).unwrap();
        let handle = IndexedSearchHandle::new(Ok(fixture.path()));
        handle.inner.enabled.store(true, Ordering::SeqCst);
        assert!(handle.query_paths(query()).unwrap().is_empty());
        assert!(!handle.initialize_catalog());
        assert!(handle.query_paths(query()).is_err());
        assert!(handle.request_drive_rebuild(r"C:\".into()).is_err());
        assert!(handle.inner.work_queue.lock().unwrap().is_empty());
    }
}
