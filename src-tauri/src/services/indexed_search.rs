// Indexed-search service module facade.
//
// The service has several moving parts, so the implementation is split by
// responsibility: lifecycle/state shell, background workers, reconciliation,
// and query-cache-backed reads.
#[path = "indexed_search/catalog.rs"]
mod catalog;
#[path = "indexed_search/query_cache.rs"]
mod query_cache;
#[path = "indexed_search/reconcile.rs"]
mod reconcile;
#[path = "indexed_search/scan.rs"]
mod scan;
#[path = "indexed_search/service.rs"]
mod service;
#[path = "indexed_search/state.rs"]
mod state;
#[cfg(target_os = "windows")]
#[path = "indexed_search/windows.rs"]
mod windows;
#[cfg(target_os = "windows")]
#[path = "indexed_search/windows_ntfs.rs"]
mod windows_ntfs;
#[path = "indexed_search/workers.rs"]
mod workers;

pub use service::{catalog_path_for_app, IndexedSearchHandle};
