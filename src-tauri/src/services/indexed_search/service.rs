// Indexed-search lifecycle shell.
//
// This file owns construction, enable/disable state, shutdown state, and the
// small mutation helpers shared by worker and reconcile modules. Backend scans,
// path reconciliation, and query caching live beside it in focused modules.
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};

use tauri::{AppHandle, Manager};

use crate::domain::indexed_search::{
    IndexedDriveState, IndexedDriveStatus, IndexedSearchServiceState, IndexedSearchServiceStatus,
};

use super::{catalog, query_cache::QueryCache, state};

#[derive(Clone)]
pub struct IndexedSearchHandle {
    pub(super) inner: Arc<IndexedSearchInner>,
}

pub(super) struct IndexedSearchInner {
    pub(super) state: Mutex<state::IndexedSearchState>,
    pub(super) catalog: Option<catalog::IndexedCatalogStore>,
    pub(super) catalog_error: Mutex<Option<String>>,
    // SQLite gives us one writer at a time. Keep that rule explicit here so
    // long scans, watcher-driven refreshes, and direct write-through updates
    // do not fight each other and surface noisy "database is locked" errors.
    pub(super) write_gate: Mutex<()>,
    pub(super) query_cache: Mutex<QueryCache>,
    pub(super) catalog_revision: AtomicU64,
    pub(super) enabled: AtomicBool,
    pub(super) shutting_down: AtomicBool,
}

impl IndexedSearchHandle {
    pub fn init(app_handle: AppHandle) -> Self {
        let catalog = catalog::IndexedCatalogStore::open(resolve_catalog_path(&app_handle));
        let discovered_statuses = discover_drive_statuses();
        eprintln!(
            "[indexed-search] init: discovered_drives={} catalog_available={}",
            discovered_statuses.len(),
            catalog.is_ok()
        );
        if let Err(error) = &catalog {
            eprintln!("[indexed-search] init: catalog_open_error={error}");
        }
        let restored_statuses = match &catalog {
            Ok(store) => restore_drive_statuses_from_catalog(discovered_statuses, store),
            Err(_) => discovered_statuses,
        };
        eprintln!(
            "[indexed-search] init: restored_drives={}",
            restored_statuses.len()
        );
        let handle = Self {
            inner: Arc::new(IndexedSearchInner {
                state: Mutex::new(state::IndexedSearchState::new()),
                catalog: catalog.as_ref().ok().cloned(),
                catalog_error: Mutex::new(catalog.as_ref().err().cloned()),
                write_gate: Mutex::new(()),
                query_cache: Mutex::new(QueryCache::new()),
                catalog_revision: AtomicU64::new(0),
                enabled: AtomicBool::new(false),
                shutting_down: AtomicBool::new(false),
            }),
        };

        handle.initialize_drive_statuses(restored_statuses, IndexedSearchServiceState::Disabled);

        match catalog {
            Ok(_) => {}
            Err(error) => handle.fail_initialization(error),
        }

        handle
    }

    pub fn service_status(&self) -> IndexedSearchServiceStatus {
        let guard = self.inner.state.lock().expect("indexed search state lock");
        guard.service_status.clone()
    }

    pub fn set_enabled(&self, enabled: bool) {
        if self.is_shutting_down() {
            eprintln!("[indexed-search] set_enabled: ignored during shutdown enabled={enabled}");
            return;
        }

        let was_enabled = self.inner.enabled.swap(enabled, Ordering::SeqCst);
        eprintln!(
            "[indexed-search] set_enabled: requested={} previous={} catalog_available={}",
            enabled,
            was_enabled,
            self.inner.catalog.is_some()
        );
        if was_enabled == enabled {
            eprintln!("[indexed-search] set_enabled: no-op unchanged enabled={enabled}");
            return;
        }

        if enabled {
            if !self.has_catalog() {
                eprintln!("[indexed-search] set_enabled: catalog unavailable");
                self.mark_catalog_unavailable();
                return;
            }

            let pending_count = self.pending_scan_drive_paths().len();
            eprintln!(
                "[indexed-search] set_enabled: starting initial scan pending={pending_count}"
            );
            self.set_service_state(IndexedSearchServiceState::Idle, None);
            self.spawn_initial_scan();
            return;
        }

        self.clear_query_cache();
        self.reset_disabled_drive_statuses();
        self.set_service_state(IndexedSearchServiceState::Disabled, None);
    }

    pub fn shutdown(&self) {
        if self.inner.shutting_down.swap(true, Ordering::SeqCst) {
            return;
        }
    }

    pub fn drive_statuses(&self) -> Vec<IndexedDriveStatus> {
        if !self.is_enabled() {
            return Vec::new();
        }

        let guard = self.inner.state.lock().expect("indexed search state lock");
        guard.drive_statuses_snapshot()
    }

    pub(super) fn initialize_drive_statuses(
        &self,
        statuses: Vec<IndexedDriveStatus>,
        service_state: IndexedSearchServiceState,
    ) {
        let mut guard = self.inner.state.lock().expect("indexed search state lock");
        guard.replace_drive_statuses(statuses, service_state, None);
    }

    pub(super) fn fail_initialization(&self, error: String) {
        eprintln!("[indexed-search] fail_initialization: {error}");
        self.remember_catalog_error(&error);
        self.mark_catalog_unavailable();
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

    pub(super) fn pending_scan_drive_paths(&self) -> Vec<String> {
        let guard = self.inner.state.lock().expect("indexed search state lock");
        guard
            .drive_statuses
            .values()
            .filter(|status| {
                status.indexable
                    && matches!(
                        status.state,
                        IndexedDriveState::Queued
                            | IndexedDriveState::Stale
                            | IndexedDriveState::RescanRequired
                            | IndexedDriveState::Error
                    )
            })
            .map(|status| status.drive_path.clone())
            .collect()
    }

    pub(super) fn touch_drive_status(&self, drive_path: &str) {
        let mut guard = self.inner.state.lock().expect("indexed search state lock");
        guard.touch_drive(drive_path);
    }

    pub(super) fn set_drive_summary(
        &self,
        drive_path: &str,
        entry_count: Option<u64>,
        source_label: Option<String>,
    ) {
        let mut guard = self.inner.state.lock().expect("indexed search state lock");
        guard.set_drive_summary(drive_path, entry_count, source_label);
    }

    pub(super) fn is_shutting_down(&self) -> bool {
        self.inner.shutting_down.load(Ordering::SeqCst)
    }

    pub(super) fn is_enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::SeqCst)
    }

    pub(super) fn should_cancel_scan(&self) -> bool {
        self.is_shutting_down() || !self.is_enabled()
    }

    pub(super) fn has_catalog(&self) -> bool {
        self.inner.catalog.is_some()
    }

    pub(super) fn catalog_unavailable_message(&self) -> String {
        self.inner
            .catalog_error
            .lock()
            .expect("indexed search catalog error lock")
            .clone()
            .unwrap_or_else(|| "Indexed-search catalog is unavailable.".to_string())
    }

    pub(super) fn mark_catalog_unavailable(&self) {
        let reason = self.catalog_unavailable_message();
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

    fn remember_catalog_error(&self, error: &str) {
        let mut guard = self
            .inner
            .catalog_error
            .lock()
            .expect("indexed search catalog error lock");
        *guard = Some(error.to_string());
    }
}

#[cfg(target_os = "windows")]
fn discover_drive_statuses() -> Vec<IndexedDriveStatus> {
    super::windows::discover_drive_statuses()
}

#[cfg(not(target_os = "windows"))]
fn discover_drive_statuses() -> Vec<IndexedDriveStatus> {
    Vec::new()
}

fn resolve_catalog_path(app_handle: &AppHandle) -> std::path::PathBuf {
    app_handle
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("indexed-search")
        .join("catalog.db")
}

pub fn catalog_path_for_app(app_handle: &AppHandle) -> std::path::PathBuf {
    resolve_catalog_path(app_handle)
}

fn restore_drive_statuses_from_catalog(
    mut discovered_statuses: Vec<IndexedDriveStatus>,
    catalog: &catalog::IndexedCatalogStore,
) -> Vec<IndexedDriveStatus> {
    let Ok(snapshots) = catalog.load_ready_drive_snapshots() else {
        return discovered_statuses;
    };

    let snapshot_map = snapshots
        .into_iter()
        .map(|snapshot| (state::normalize_drive_key(&snapshot.drive_path), snapshot))
        .collect::<std::collections::BTreeMap<_, _>>();

    for status in &mut discovered_statuses {
        if !status.indexable {
            continue;
        }

        let key = state::normalize_drive_key(&status.drive_path);
        let Some(snapshot) = snapshot_map.get(&key) else {
            continue;
        };

        status.state = IndexedDriveState::Ready;
        status.started_at = snapshot.last_scan_completed_at.or(status.started_at);
        status.last_updated_at = snapshot
            .last_scan_completed_at
            .unwrap_or(status.last_updated_at);
        status.entry_count = Some(snapshot.entry_count as u64);
        status.source_label = snapshot.last_scan_source.clone();
        status.message = None;
    }

    discovered_statuses
}
