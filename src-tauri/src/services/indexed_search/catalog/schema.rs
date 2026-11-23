// Core catalog schema and migrations for existing entry rows.
use std::fs;
use std::path::PathBuf;

use rusqlite::{Connection, TransactionBehavior};

use super::{search_index, IndexedCatalogStore};

pub(super) const DRIVE_CATALOG_STATE_READY: &str = "ready";

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS indexed_entries (
    entry_id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    normalized_name TEXT NOT NULL,
    kind INTEGER NOT NULL,
    size_bytes INTEGER
);

CREATE TABLE IF NOT EXISTS indexed_drive_catalog_state (
    drive_path TEXT PRIMARY KEY,
    lifecycle_state TEXT NOT NULL,
    last_scan_source TEXT,
    last_scan_started_at INTEGER,
    last_scan_completed_at INTEGER,
    volume_id TEXT,
    journal_id INTEGER,
    journal_next_usn INTEGER,
    saved_entry_count INTEGER
);

CREATE TABLE IF NOT EXISTS indexed_catalog_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS indexed_size_backfills (
    drive_path TEXT PRIMARY KEY COLLATE NOCASE,
    after_path TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS indexed_pending_renames (
    drive_path TEXT NOT NULL,
    file_id INTEGER NOT NULL,
    old_parent_id INTEGER NOT NULL,
    old_path TEXT NOT NULL,
    PRIMARY KEY (drive_path, file_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS indexed_recursive_builds (
    drive_path TEXT PRIMARY KEY,
    attempt BLOB NOT NULL,
    active_dir TEXT,
    completed_entries INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS indexed_recursive_directories (
    drive_path TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    PRIMARY KEY (drive_path, relative_path)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS indexed_entries_normalized_name_idx
    ON indexed_entries(normalized_name);
"#;

impl IndexedCatalogStore {
    pub(in crate::services::indexed_search) fn open(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create indexed-search catalog directory {}: {error}",
                    parent.display()
                )
            })?;
        }

        let store = Self::new(db_path);
        initialize_catalog_schema(&mut store.connect()?)?;
        Ok(store)
    }
}

pub(super) fn begin_write_transaction(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|error| format!("Failed to start indexed-search write transaction: {error}"))
}

fn initialize_catalog_schema(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
        .map_err(|error| format!("Failed to configure indexed-search catalog: {error}"))?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Failed to start indexed-search schema migration: {error}"))?;

    let entry_columns = load_table_columns(&transaction, "indexed_entries")?;
    let has_entry_id = entry_columns.iter().any(|column| column == "entry_id");
    let has_file_sizes = entry_columns.iter().any(|column| column == "size_bytes");
    if !entry_columns.is_empty() && !has_entry_id {
        migrate_indexed_entries_table(&transaction)?;
    }
    transaction
        .execute_batch(SCHEMA_SQL)
        .map_err(|error| format!("Failed to initialize indexed-search catalog: {error}"))?;
    migrate_drive_snapshot_columns(&transaction)?;
    if !entry_columns.is_empty() && !has_file_sizes {
        // A nullable, unconstrained column is added without rewriting this table.
        // Entry IDs and the existing FTS index stay intact.
        if has_entry_id {
            transaction
                .execute_batch("ALTER TABLE indexed_entries ADD COLUMN size_bytes INTEGER")
                .map_err(|error| format!("Failed to add indexed-search file sizes: {error}"))?;
        }
        transaction
            .execute_batch(
                "INSERT OR IGNORE INTO indexed_size_backfills (drive_path, after_path)
                 SELECT drive_path, '' FROM indexed_drive_catalog_state",
            )
            .map_err(|error| format!("Failed to schedule indexed-search size backfill: {error}"))?;
    }
    if entry_columns.is_empty() {
        create_size_index(&transaction)?;
    }
    search_index::initialize(&transaction)?;
    transaction
        .commit()
        .map_err(|error| format!("Failed to commit indexed-search schema migration: {error}"))
}

pub(super) fn create_size_index(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS indexed_entries_size_bytes_idx
         ON indexed_entries(size_bytes) WHERE size_bytes IS NOT NULL",
        )
        .map_err(|error| format!("Failed to build the indexed-search file size index: {error}"))
}

fn migrate_drive_snapshot_columns(connection: &Connection) -> Result<(), String> {
    let columns = load_table_columns(connection, "indexed_drive_catalog_state")?;
    // A drive's old letter cannot establish its identity. Leave the new columns
    // NULL so those rows stay on disk without being accepted as verified snapshots.
    for (name, column) in [
        ("volume_id", "volume_id TEXT"),
        ("journal_id", "journal_id INTEGER"),
        ("journal_next_usn", "journal_next_usn INTEGER"),
        ("saved_entry_count", "saved_entry_count INTEGER"),
    ] {
        if !columns.iter().any(|existing| existing == name) {
            connection
                .execute_batch(&format!(
                    "ALTER TABLE indexed_drive_catalog_state ADD COLUMN {column}"
                ))
                .map_err(|error| {
                    format!("Failed to add indexed-search volume metadata: {error}")
                })?;
        }
    }
    Ok(())
}

fn load_table_columns(connection: &Connection, table_name: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(|error| format!("Failed to inspect indexed-search catalog schema: {error}"))?;

    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Failed to read indexed-search catalog schema: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to collect indexed-search catalog columns: {error}"))
}

fn migrate_indexed_entries_table(connection: &Connection) -> Result<(), String> {
    // Older catalogs used the path as the primary key. FTS needs a stable
    // integer row ID for each entry, so let SQLite allocate IDs for those rows.
    connection
        .execute_batch(
            "CREATE TABLE indexed_entries_next (
                 entry_id INTEGER PRIMARY KEY,
                 path TEXT NOT NULL UNIQUE,
                 normalized_name TEXT NOT NULL,
                 kind INTEGER NOT NULL,
                 size_bytes INTEGER
             );
             INSERT INTO indexed_entries_next (path, normalized_name, kind)
             SELECT path, normalized_name, kind
             FROM indexed_entries;
             DROP TABLE indexed_entries;
             ALTER TABLE indexed_entries_next RENAME TO indexed_entries;",
        )
        .map_err(|error| format!("Failed to upgrade the indexed-search catalog schema: {error}"))
}
