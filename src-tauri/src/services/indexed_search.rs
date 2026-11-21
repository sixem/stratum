// Indexed-search service module facade.
//
// The service has several moving parts, so the implementation is split by
// responsibility: lifecycle/state shell, background workers, reconciliation,
// and query-cache-backed reads.
#[path = "indexed_search/catalog.rs"]
mod catalog;
#[cfg(test)]
#[path = "indexed_search/journal_batch.rs"]
mod journal_batch;
#[path = "indexed_search/journal_tracking.rs"]
mod journal_tracking;
#[path = "indexed_search/profile_catalog.rs"]
mod profile_catalog;
#[path = "indexed_search/query_cache.rs"]
mod query_cache;
#[path = "indexed_search/reconcile.rs"]
mod reconcile;
#[cfg(windows)]
#[path = "indexed_search/resumable_scan.rs"]
mod resumable_scan;
#[path = "indexed_search/scan.rs"]
mod scan;
#[path = "indexed_search/service.rs"]
mod service;
#[path = "indexed_search/state.rs"]
mod state;
#[cfg(windows)]
#[path = "indexed_search/user_journal_reconcile.rs"]
mod user_journal_reconcile;
#[path = "indexed_search/volume_tracking.rs"]
mod volume_tracking;
#[cfg(windows)]
#[path = "indexed_search/watched_paths.rs"]
mod watched_paths;
#[cfg(target_os = "windows")]
#[path = "indexed_search/windows.rs"]
mod windows;
#[cfg(all(test, target_os = "windows"))]
#[path = "indexed_search/windows_backlog_stress.rs"]
mod windows_backlog_stress;
#[cfg(target_os = "windows")]
#[path = "indexed_search/windows_journal.rs"]
mod windows_journal;
#[cfg(windows)]
#[path = "indexed_search/windows_user_journal.rs"]
mod windows_user_journal;
#[cfg(all(test, windows))]
#[path = "indexed_search/windows_user_journal_integration.rs"]
mod windows_user_journal_integration;
#[path = "indexed_search/work_queue.rs"]
mod work_queue;
#[path = "indexed_search/workers.rs"]
mod workers;

pub use service::{catalog_path_for_app, IndexedSearchHandle};
