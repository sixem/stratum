// Durable indexed-search catalog backed by SQLite.
//
// The store facade keeps shared SQLite connection details and catalog data
// shapes in one place. Schema setup, writes, query planning, and ranking live
// in focused modules under catalog/.
#[path = "catalog/pagination.rs"]
mod pagination;
#[path = "catalog/query.rs"]
mod query;
#[path = "catalog/ranking.rs"]
mod ranking;
#[path = "catalog/recursive_build.rs"]
pub(super) mod recursive_build;
#[cfg(test)]
#[path = "catalog/renames.rs"]
mod renames;
#[path = "catalog/schema.rs"]
mod schema;
#[path = "catalog/search_index.rs"]
mod search_index;
#[cfg(windows)]
#[path = "catalog/size_backfill.rs"]
mod size_backfill;
#[path = "catalog/writer.rs"]
mod writer;

use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, Row};

use crate::domain::{file_search::FileSearchFilters, indexed_search::IndexedEntryKind};

#[derive(Clone)]
pub(super) struct IndexedCatalogStore {
    db_path: PathBuf,
}

#[derive(Clone)]
pub(super) struct DriveCatalogSnapshot {
    pub(super) drive_path: String,
    pub(super) volume_id: Option<String>,
    pub(super) journal_checkpoint: Option<JournalCheckpoint>,
    pub(super) pending_renames: bool,
    pub(super) entry_count: Option<usize>,
    pub(super) last_scan_source: Option<String>,
    pub(super) last_scan_completed_at: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct JournalCheckpoint {
    pub(super) journal_id: u64,
    pub(super) next_usn: i64,
}

pub(super) struct CatalogEntryRecord {
    pub(super) path: String,
    pub(super) normalized_name: String,
    pub(super) kind: IndexedEntryKind,
    pub(super) size_bytes: Option<i64>,
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct CatalogChild {
    pub(super) kind: IndexedEntryKind,
    pub(super) size_bytes: Option<i64>,
}

pub(super) struct IndexedCatalogWriter {
    connection: Connection,
    finished: bool,
    entries_written: usize,
}

pub(super) struct CatalogQueryHit {
    path: String,
    normalized_name: String,
    kind: IndexedEntryKind,
    size_bytes: Option<u64>,
}

impl CatalogQueryHit {
    fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            path: row.get(0)?,
            kind: writer::int_to_kind(row.get(1)?),
            normalized_name: row.get(2)?,
            size_bytes: row
                .get::<_, Option<i64>>(4)?
                .and_then(|size| u64::try_from(size).ok()),
        })
    }
}

pub(super) struct QueryPlan {
    normalized_query: String,
    filters: Option<FileSearchFilters>,
    plain_terms: Vec<String>,
    like_patterns: Vec<String>,
    match_expression: Option<String>,
    limit: usize,
    fetch_limit: usize,
    has_wildcards: bool,
}

impl IndexedCatalogStore {
    fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    pub(super) fn directory(&self) -> Option<&Path> {
        self.db_path.parent()
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
