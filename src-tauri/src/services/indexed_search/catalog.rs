// Durable indexed-search catalog backed by SQLite.
//
// The store facade keeps shared SQLite connection details and catalog data
// shapes in one place. Schema setup, writes, query planning, and ranking live
// in focused modules under catalog/.
#[path = "catalog/query.rs"]
mod query;
#[path = "catalog/ranking.rs"]
mod ranking;
#[path = "catalog/schema.rs"]
mod schema;
#[path = "catalog/writer.rs"]
mod writer;

use std::path::PathBuf;
use std::time::Duration;

use rusqlite::Connection;

use crate::domain::indexed_search::IndexedEntryKind;

#[derive(Clone)]
pub(super) struct IndexedCatalogStore {
    db_path: PathBuf,
}

pub(super) struct DriveCatalogSnapshot {
    pub(super) drive_path: String,
    pub(super) entry_count: usize,
    pub(super) last_scan_source: Option<String>,
    pub(super) last_scan_completed_at: Option<u64>,
}

pub(super) struct CatalogEntryRecord {
    pub(super) path: String,
    pub(super) normalized_name: String,
    pub(super) kind: IndexedEntryKind,
}

pub(super) struct IndexedCatalogWriter {
    connection: Connection,
    finished: bool,
}

pub(super) struct CatalogQueryHit {
    path: String,
    normalized_name: String,
    kind: IndexedEntryKind,
}

pub(super) struct QueryPlan {
    normalized_query: String,
    plain_terms: Vec<String>,
    like_patterns: Vec<String>,
    candidate_tokens: Vec<String>,
    limit: usize,
    fetch_limit: usize,
    has_wildcards: bool,
}

impl IndexedCatalogStore {
    fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    pub(super) fn connect(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.db_path).map_err(|error| {
            format!(
                "Failed to open indexed-search catalog {}: {error}",
                self.db_path.display()
            )
        })?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("Failed to configure indexed-search catalog: {error}"))?;
        Ok(connection)
    }
}
