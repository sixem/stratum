// Schema initialization and catalog migrations.
//
// The catalog schema is intentionally small, but keeping migration code here
// makes it easier for contributors to review storage changes without also
// reading query planning or writer behavior.
use std::fs;
use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension};

use super::IndexedCatalogStore;

pub(super) const DRIVE_CATALOG_STATE_SCANNING: &str = "scanning";
pub(super) const DRIVE_CATALOG_STATE_READY: &str = "ready";
pub(super) const DRIVE_CATALOG_STATE_ERROR: &str = "error";
pub(super) const SEARCH_TOKENS_READY_META_KEY: &str = "searchTokensReady";

const SCHEMA_SQL: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS indexed_entries (
    entry_id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    normalized_name TEXT NOT NULL,
    kind INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS indexed_entry_trigrams (
    token TEXT NOT NULL,
    entry_id INTEGER NOT NULL,
    PRIMARY KEY (token, entry_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS indexed_drive_catalog_state (
    drive_path TEXT PRIMARY KEY,
    lifecycle_state TEXT NOT NULL,
    last_scan_source TEXT,
    last_scan_started_at INTEGER,
    last_scan_completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS indexed_catalog_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS indexed_entries_normalized_name_idx
    ON indexed_entries(normalized_name);

CREATE INDEX IF NOT EXISTS indexed_entry_trigrams_entry_id_idx
    ON indexed_entry_trigrams(entry_id);
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
        let connection = store.connect()?;
        initialize_catalog_schema(&connection)?;

        Ok(store)
    }
}

pub(super) fn begin_write_transaction(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|error| format!("Failed to start indexed-search write transaction: {error}"))
}

pub(super) fn load_meta_bool(connection: &Connection, key: &str) -> Result<Option<bool>, String> {
    let value = connection
        .query_row(
            "SELECT value FROM indexed_catalog_meta WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read indexed-search catalog metadata: {error}"))?;

    Ok(value.map(|value| value == "1"))
}

pub(super) fn store_meta_bool(
    connection: &Connection,
    key: &str,
    value: bool,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO indexed_catalog_meta (key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, if value { "1" } else { "0" }],
        )
        .map_err(|error| format!("Failed to store indexed-search catalog metadata: {error}"))?;
    Ok(())
}

pub(super) fn refresh_search_tokens_ready_meta(connection: &Connection) -> Result<bool, String> {
    let ready = catalog_has_complete_search_tokens(connection)?;
    store_meta_bool(connection, SEARCH_TOKENS_READY_META_KEY, ready)?;
    Ok(ready)
}

fn initialize_catalog_schema(connection: &Connection) -> Result<(), String> {
    let entry_columns = load_table_columns(connection, "indexed_entries")?;
    if needs_indexed_entries_migration(&entry_columns) {
        migrate_indexed_entries_table(connection)?;
    }

    connection
        .execute_batch(SCHEMA_SQL)
        .map_err(|error| format!("Failed to initialize indexed-search catalog: {error}"))?;
    ensure_catalog_meta_defaults(connection)?;
    refresh_search_tokens_ready_meta(connection)?;
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

fn needs_indexed_entries_migration(columns: &[String]) -> bool {
    if columns.is_empty() {
        return false;
    }

    !columns.iter().any(|column| column == "entry_id")
}

fn migrate_indexed_entries_table(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "BEGIN IMMEDIATE;
             DROP INDEX IF EXISTS indexed_entries_normalized_name_idx;
             DROP INDEX IF EXISTS indexed_entries_drive_path_idx;
             DROP TABLE IF EXISTS indexed_entry_trigrams;
             DROP TABLE IF EXISTS indexed_entries_next;
             CREATE TABLE indexed_entries_next (
                 entry_id INTEGER PRIMARY KEY,
                 path TEXT NOT NULL UNIQUE,
                 normalized_name TEXT NOT NULL,
                 kind INTEGER NOT NULL
             );
             INSERT INTO indexed_entries_next (path, normalized_name, kind)
             SELECT path, normalized_name, kind
             FROM indexed_entries;
             DROP TABLE indexed_entries;
             ALTER TABLE indexed_entries_next RENAME TO indexed_entries;
             COMMIT;",
        )
        .map_err(|error| format!("Failed to upgrade the indexed-search catalog schema: {error}"))?;

    connection
        .execute_batch("VACUUM;")
        .map_err(|error| format!("Failed to reclaim indexed-search catalog space: {error}"))?;

    Ok(())
}

fn ensure_catalog_meta_defaults(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO indexed_catalog_meta (key, value) VALUES (?1, ?2)",
            params![SEARCH_TOKENS_READY_META_KEY, "1"],
        )
        .map_err(|error| {
            format!("Failed to initialize indexed-search catalog metadata: {error}")
        })?;
    Ok(())
}

fn catalog_has_complete_search_tokens(connection: &Connection) -> Result<bool, String> {
    let ready = connection
        .query_row(
            "SELECT NOT EXISTS (
                SELECT 1
                FROM indexed_entries entry
                LEFT JOIN indexed_entry_trigrams trigram
                    ON trigram.entry_id = entry.entry_id
                WHERE trigram.entry_id IS NULL
                LIMIT 1
            )",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| {
            format!("Failed to verify indexed-search helper token coverage: {error}")
        })?;
    Ok(ready != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory catalog");
        initialize_catalog_schema(&connection).expect("initialize catalog schema");
        connection
    }

    #[test]
    fn empty_catalog_starts_with_search_tokens_ready() {
        let connection = open_test_connection();

        let ready = load_meta_bool(&connection, SEARCH_TOKENS_READY_META_KEY)
            .expect("load search token readiness")
            .expect("search token readiness metadata");

        assert!(ready);
    }

    #[test]
    fn catalog_with_entries_missing_tokens_marks_readiness_false() {
        let connection = open_test_connection();
        connection
            .execute(
                "INSERT INTO indexed_entries (path, normalized_name, kind) VALUES (?1, ?2, ?3)",
                params!["C:\\alpha.txt", "alpha.txt", 0i64],
            )
            .expect("insert indexed entry");

        let ready =
            refresh_search_tokens_ready_meta(&connection).expect("refresh search token readiness");
        assert!(!ready);
    }

    #[test]
    fn catalog_with_complete_token_rows_marks_readiness_true() {
        let connection = open_test_connection();
        connection
            .execute(
                "INSERT INTO indexed_entries (entry_id, path, normalized_name, kind)
                 VALUES (?1, ?2, ?3, ?4)",
                params![1i64, "C:\\alpha.txt", "alpha.txt", 0i64],
            )
            .expect("insert indexed entry");
        connection
            .execute(
                "INSERT INTO indexed_entry_trigrams (token, entry_id) VALUES (?1, ?2)",
                params!["alp", 1i64],
            )
            .expect("insert trigram token");

        let ready =
            refresh_search_tokens_ready_meta(&connection).expect("refresh search token readiness");
        assert!(ready);
    }
}
