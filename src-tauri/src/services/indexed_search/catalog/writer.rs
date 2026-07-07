// Catalog write sessions and drive scan lifecycle persistence.
//
// Writers wrap explicit SQLite transactions. Dropping an unfinished writer
// rolls the transaction back, which lets cancellation and errors leave the
// catalog in its previous coherent state.
use std::path::Path;

use rusqlite::{params, Connection};

use crate::domain::indexed_search::IndexedEntryKind;

use super::{
    query::collect_search_tokens, schema, CatalogEntryRecord, IndexedCatalogStore,
    IndexedCatalogWriter,
};

impl IndexedCatalogStore {
    pub(in crate::services::indexed_search) fn begin_drive_refresh(
        &self,
        drive_path: &str,
    ) -> Result<IndexedCatalogWriter, String> {
        let connection = self.connect()?;
        mark_drive_scan_started(&connection, drive_path)?;
        schema::begin_write_transaction(&connection)?;
        let drive_pattern = build_drive_refresh_pattern(drive_path);

        connection
            .execute(
                "DELETE FROM indexed_entry_trigrams
                 WHERE entry_id IN (
                    SELECT entry_id
                    FROM indexed_entries
                    WHERE path LIKE ?1 ESCAPE '\\'
                 )",
                params![drive_pattern],
            )
            .map_err(|error| {
                format!("Failed to clear indexed-search search tokens for {drive_path}: {error}")
            })?;

        connection
            .execute(
                "DELETE FROM indexed_entries WHERE path LIKE ?1 ESCAPE '\\'",
                params![drive_pattern],
            )
            .map_err(|error| {
                format!("Failed to clear indexed-search entries for {drive_path}: {error}")
            })?;

        Ok(IndexedCatalogWriter {
            connection,
            finished: false,
        })
    }

    pub(in crate::services::indexed_search) fn begin_write(
        &self,
    ) -> Result<IndexedCatalogWriter, String> {
        let connection = self.connect()?;
        schema::begin_write_transaction(&connection)?;
        Ok(IndexedCatalogWriter {
            connection,
            finished: false,
        })
    }

    pub(in crate::services::indexed_search) fn mark_drive_scan_ready(
        &self,
        drive_path: &str,
        scan_source: &str,
        completed_at: u64,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        connection
            .execute(
                "INSERT INTO indexed_drive_catalog_state (
                    drive_path,
                    lifecycle_state,
                    last_scan_source,
                    last_scan_started_at,
                    last_scan_completed_at
                 ) VALUES (
                    ?1,
                    ?2,
                    ?3,
                    COALESCE(
                        (SELECT last_scan_started_at
                         FROM indexed_drive_catalog_state
                         WHERE drive_path = ?1),
                        ?4
                    ),
                    ?4
                 )
                 ON CONFLICT(drive_path) DO UPDATE SET
                    lifecycle_state = excluded.lifecycle_state,
                    last_scan_source = excluded.last_scan_source,
                    last_scan_started_at = COALESCE(
                        indexed_drive_catalog_state.last_scan_started_at,
                        excluded.last_scan_started_at
                    ),
                    last_scan_completed_at = excluded.last_scan_completed_at",
                params![
                    drive_path,
                    schema::DRIVE_CATALOG_STATE_READY,
                    scan_source,
                    completed_at as i64,
                ],
            )
            .map_err(|error| {
                format!("Failed to finalize indexed-search drive state for {drive_path}: {error}")
            })?;
        Ok(())
    }

    pub(in crate::services::indexed_search) fn mark_drive_scan_failed(
        &self,
        drive_path: &str,
        failed_at: u64,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        connection
            .execute(
                "INSERT INTO indexed_drive_catalog_state (
                    drive_path,
                    lifecycle_state,
                    last_scan_started_at
                 ) VALUES (?1, ?2, ?3)
                 ON CONFLICT(drive_path) DO UPDATE SET
                    lifecycle_state = excluded.lifecycle_state,
                    last_scan_started_at = COALESCE(
                        indexed_drive_catalog_state.last_scan_started_at,
                        excluded.last_scan_started_at
                    )",
                params![
                    drive_path,
                    schema::DRIVE_CATALOG_STATE_ERROR,
                    failed_at as i64,
                ],
            )
            .map_err(|error| {
                format!(
                    "Failed to mark indexed-search drive scan failure for {drive_path}: {error}"
                )
            })?;
        Ok(())
    }
}

impl IndexedCatalogWriter {
    pub(in crate::services::indexed_search) fn remove_path_trees(
        &mut self,
        paths: &[String],
    ) -> Result<(), String> {
        if paths.is_empty() {
            return Ok(());
        }

        let mut delete_tokens = self
            .connection
            .prepare(
                "DELETE FROM indexed_entry_trigrams
                 WHERE entry_id IN (
                    SELECT entry_id
                    FROM indexed_entries
                    WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'
                 )",
            )
            .map_err(|error| format!("Failed to prepare indexed-search token delete: {error}"))?;
        let mut delete_entries = self
            .connection
            .prepare("DELETE FROM indexed_entries WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'")
            .map_err(|error| format!("Failed to prepare indexed-search delete: {error}"))?;

        for path in paths {
            let trimmed = trim_catalog_path(path);
            if trimmed.is_empty() {
                continue;
            }

            let descendant_pattern = build_descendant_pattern(trimmed);
            delete_tokens
                .execute(params![trimmed, &descendant_pattern])
                .map_err(|error| {
                    format!("Failed to remove indexed-search tokens for {trimmed}: {error}")
                })?;
            delete_entries
                .execute(params![trimmed, descendant_pattern])
                .map_err(|error| {
                    format!("Failed to remove indexed-search entries for {trimmed}: {error}")
                })?;
        }

        Ok(())
    }

    pub(in crate::services::indexed_search) fn insert_batch(
        &mut self,
        entries: &[CatalogEntryRecord],
    ) -> Result<(), String> {
        if entries.is_empty() {
            return Ok(());
        }

        let mut insert_entry = self
            .connection
            .prepare(
                "INSERT INTO indexed_entries (
                    path,
                    normalized_name,
                    kind
                ) VALUES (?1, ?2, ?3)",
            )
            .map_err(|error| format!("Failed to prepare indexed-search insert: {error}"))?;
        let mut insert_token = self
            .connection
            .prepare(
                "INSERT OR IGNORE INTO indexed_entry_trigrams (
                    token,
                    entry_id
                ) VALUES (?1, ?2)",
            )
            .map_err(|error| format!("Failed to prepare indexed-search token insert: {error}"))?;

        for entry in entries {
            insert_entry
                .execute(params![
                    &entry.path,
                    &entry.normalized_name,
                    kind_to_int(entry.kind),
                ])
                .map_err(|error| format!("Failed to insert indexed-search entry: {error}"))?;

            let entry_id = self.connection.last_insert_rowid();
            for token in collect_search_tokens(&entry.normalized_name) {
                insert_token
                    .execute(params![token, entry_id])
                    .map_err(|error| {
                        format!("Failed to insert indexed-search search token: {error}")
                    })?;
            }
        }

        Ok(())
    }

    pub(in crate::services::indexed_search) fn finish(mut self) -> Result<(), String> {
        schema::refresh_search_tokens_ready_meta(&self.connection)?;
        self.connection.execute_batch("COMMIT").map_err(|error| {
            format!("Failed to commit indexed-search write transaction: {error}")
        })?;
        self.finished = true;
        Ok(())
    }

    pub(in crate::services::indexed_search) fn checkpoint(&mut self) -> Result<(), String> {
        schema::refresh_search_tokens_ready_meta(&self.connection)?;
        self.connection
            .execute_batch("COMMIT; BEGIN IMMEDIATE;")
            .map_err(|error| {
                format!("Failed to checkpoint indexed-search write transaction: {error}")
            })
    }
}

impl Drop for IndexedCatalogWriter {
    fn drop(&mut self) {
        if self.finished {
            return;
        }

        let _ = self.connection.execute_batch("ROLLBACK");
    }
}

impl CatalogEntryRecord {
    pub(in crate::services::indexed_search) fn new(
        path: String,
        normalized_name: String,
        kind: IndexedEntryKind,
    ) -> Self {
        Self {
            normalized_name,
            path,
            kind,
        }
    }

    pub(in crate::services::indexed_search) fn from_path(
        path: &Path,
        kind: IndexedEntryKind,
    ) -> Option<Self> {
        let name = path.file_name()?.to_string_lossy().trim().to_string();
        if name.is_empty() {
            return None;
        }

        Some(Self::new(
            path.to_string_lossy().to_string(),
            name.to_lowercase(),
            kind,
        ))
    }
}

pub(super) fn kind_to_int(kind: IndexedEntryKind) -> i64 {
    match kind {
        IndexedEntryKind::File => 0,
        IndexedEntryKind::Directory => 1,
    }
}

pub(super) fn int_to_kind(value: i64) -> IndexedEntryKind {
    if value == 1 {
        IndexedEntryKind::Directory
    } else {
        IndexedEntryKind::File
    }
}

pub(super) fn trim_catalog_path(path: &str) -> &str {
    let trimmed = path.trim();
    if trimmed.len() <= 3 {
        trimmed
    } else {
        trimmed.trim_end_matches(['\\', '/'])
    }
}

pub(super) fn entry_name_from_catalog_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path.to_string())
}

pub(super) fn parent_path_from_catalog_path(path: &str) -> Option<String> {
    Path::new(path)
        .parent()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn drive_root_from_catalog_path(path: &str) -> Option<String> {
    let trimmed = trim_catalog_path(path);
    let bytes = trimmed.as_bytes();
    if bytes.len() < 2 || bytes[1] != b':' {
        return None;
    }

    let drive_letter = trimmed.chars().next()?.to_ascii_uppercase();
    Some(format!("{drive_letter}:\\"))
}

fn build_descendant_pattern(path: &str) -> String {
    let escaped = escape_like_literal(path);
    format!("{escaped}\\\\%")
}

fn build_drive_refresh_pattern(drive_path: &str) -> String {
    format!("{}%", escape_like_literal(trim_catalog_path(drive_path)))
}

fn escape_like_literal(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '%' | '_' | '\\' => {
                escaped.push('\\');
                escaped.push(character);
            }
            _ => escaped.push(character),
        }
    }
    escaped
}

fn mark_drive_scan_started(connection: &Connection, drive_path: &str) -> Result<(), String> {
    let started_at = crate::services::indexed_search::state::now_epoch_ms() as i64;
    connection
        .execute(
            "INSERT INTO indexed_drive_catalog_state (
                drive_path,
                lifecycle_state,
                last_scan_started_at
             ) VALUES (?1, ?2, ?3)
             ON CONFLICT(drive_path) DO UPDATE SET
                lifecycle_state = excluded.lifecycle_state,
                last_scan_started_at = excluded.last_scan_started_at",
            params![drive_path, schema::DRIVE_CATALOG_STATE_SCANNING, started_at,],
        )
        .map_err(|error| {
            format!("Failed to mark indexed-search drive scan start for {drive_path}: {error}")
        })?;
    Ok(())
}
