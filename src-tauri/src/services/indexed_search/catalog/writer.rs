// Catalog write sessions and drive scan lifecycle persistence.
//
// Writers wrap explicit SQLite transactions. Dropping an unfinished writer
// rolls the transaction back, which lets cancellation and errors leave the
// catalog in its previous coherent state.
use std::path::Path;

#[cfg(windows)]
use rusqlite::OptionalExtension;
use rusqlite::{params, Connection};

use crate::domain::indexed_search::IndexedEntryKind;

use super::{
    recursive_build, schema, CatalogEntryRecord, IndexedCatalogStore, IndexedCatalogWriter,
    JournalCheckpoint,
};

#[path = "writer_paths.rs"]
mod paths;

impl IndexedCatalogStore {
    pub(in crate::services::indexed_search) fn begin_drive_refresh(
        &self,
        drive_path: &str,
    ) -> Result<IndexedCatalogWriter, String> {
        let connection = self.connect()?;
        schema::begin_write_transaction(&connection)?;
        // Readers keep using the previous drive snapshot until the replacement and
        // its ready metadata commit together. Catalog triggers update FTS inside
        // this same transaction.
        delete_drive_entries(&connection, drive_path).map_err(|error| {
            format!("Failed to clear indexed-search entries for {drive_path}: {error}")
        })?;
        // The replacement baseline supersedes any half-read rename from the
        // previous journal or volume at this drive letter.
        connection
            .execute(
                "DELETE FROM indexed_pending_renames WHERE drive_path = ?1",
                [drive_path],
            )
            .map_err(|error| {
                format!("Failed to clear pending renames for {drive_path}: {error}")
            })?;

        Ok(IndexedCatalogWriter {
            connection,
            finished: false,
            entries_written: 0,
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
            entries_written: 0,
        })
    }

    pub(in crate::services::indexed_search) fn begin_watched_write_if_changed(
        &self,
        path: &str,
        replacement: &[CatalogEntryRecord],
        limit: usize,
    ) -> Result<Option<IndexedCatalogWriter>, String> {
        let mut connection = self.connect()?;
        let read = connection
            .transaction()
            .map_err(|error| format!("Failed to start indexed-search watch comparison: {error}"))?;
        if !paths::bounded_tree_differs(&read, path, replacement, limit)? {
            return Ok(None);
        }
        read.commit().map_err(|error| {
            format!("Failed to finish indexed-search watch comparison: {error}")
        })?;
        // The single worker holds both operations, but an external process
        // can open this catalog. Recheck the existing deletion cap and
        // ambiguous path rules when applying the change.
        schema::begin_write_transaction(&connection)?;
        Ok(Some(IndexedCatalogWriter {
            connection,
            finished: false,
            entries_written: 0,
        }))
    }
}

fn delete_drive_entries(connection: &Connection, drive_path: &str) -> rusqlite::Result<()> {
    let drive_path = trim_catalog_path(drive_path);
    if let [letter, b':', b'\\'] = drive_path.as_bytes() {
        if letter.is_ascii_alphabetic() {
            // ']' immediately follows '\\', so each range seeks directly to
            // one letter case in the existing binary path index.
            let mut delete =
                connection.prepare("DELETE FROM indexed_entries WHERE path >= ?1 AND path < ?2")?;
            for letter in [letter.to_ascii_uppercase(), letter.to_ascii_lowercase()] {
                let letter = char::from(letter);
                delete.execute(params![format!("{letter}:\\"), format!("{letter}:]")])?;
            }
            return Ok(());
        }
    }

    connection.execute(
        "DELETE FROM indexed_entries WHERE path LIKE ?1 ESCAPE '\\'",
        [build_drive_refresh_pattern(drive_path)],
    )?;
    Ok(())
}

impl IndexedCatalogWriter {
    #[cfg(windows)]
    pub(in crate::services::indexed_search) fn indexed_children(
        &self,
        parent: &str,
    ) -> Result<std::collections::BTreeMap<String, Option<IndexedEntryKind>>, String> {
        paths::indexed_children(&self.connection, parent)
    }

    #[cfg(windows)]
    pub(in crate::services::indexed_search) fn remove_exact_path_tree(
        &mut self,
        path: &str,
    ) -> Result<usize, String> {
        paths::remove_exact_path_tree(&self.connection, path)
    }

    #[cfg(windows)]
    pub(in crate::services::indexed_search) fn adjust_saved_entry_count(
        &self,
        drive: &str,
        removed: usize,
    ) -> Result<Option<usize>, String> {
        self.connection
            .query_row(
                "UPDATE indexed_drive_catalog_state
                 SET saved_entry_count = MAX(0, saved_entry_count + ?2 - ?3)
                 WHERE drive_path = ?1 AND saved_entry_count IS NOT NULL
                 RETURNING saved_entry_count",
                params![drive, self.entries_written, removed],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Failed to adjust indexed-search entry count: {error}"))
    }

    // A false result requires rolling back this writer and rescanning the
    // volume. Some paths may already have been deleted in the transaction.
    pub(in crate::services::indexed_search) fn remove_path_trees(
        &mut self,
        paths: &[String],
    ) -> Result<bool, String> {
        paths::remove_path_trees(&self.connection, paths, None)
    }

    pub(in crate::services::indexed_search) fn remove_watched_path_trees(
        &mut self,
        paths: &[String],
        limit: usize,
    ) -> Result<bool, String> {
        paths::remove_path_trees(&self.connection, paths, Some(limit))
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
            // Every catalog batch uses the same statement on this writer connection.
            .prepare_cached(
                "INSERT INTO indexed_entries (
                    path,
                    normalized_name,
                    kind
                ) VALUES (?1, ?2, ?3)",
            )
            .map_err(|error| format!("Failed to prepare indexed-search insert: {error}"))?;
        for entry in entries {
            insert_entry
                .execute(params![
                    &entry.path,
                    &entry.normalized_name,
                    kind_to_int(entry.kind),
                ])
                .map_err(|error| format!("Failed to insert indexed-search entry: {error}"))?;
        }

        self.entries_written = self.entries_written.saturating_add(entries.len());
        Ok(())
    }

    pub(in crate::services::indexed_search) fn finish(self) -> Result<(), String> {
        self.commit()
    }

    pub(in crate::services::indexed_search) fn advance_journal_checkpoint(
        &mut self,
        drive_path: &str,
        volume_id: &str,
        previous: JournalCheckpoint,
        next: JournalCheckpoint,
    ) -> Result<bool, String> {
        if next.journal_id != previous.journal_id || next.next_usn < previous.next_usn {
            return Ok(false);
        }
        // Journal IDs are unsigned Windows values. SQLite stores the same 64
        // bits as a signed INTEGER, and the read path converts them back to u64.
        let changed = self
            .connection
            .execute(
                "UPDATE indexed_drive_catalog_state SET journal_next_usn = ?1
                 WHERE drive_path = ?2 AND volume_id = ?3 AND lifecycle_state = ?4
                   AND journal_id = ?5 AND journal_next_usn = ?6",
                params![
                    next.next_usn,
                    drive_path,
                    volume_id,
                    schema::DRIVE_CATALOG_STATE_READY,
                    previous.journal_id as i64,
                    previous.next_usn,
                ],
            )
            .map_err(|error| {
                format!(
                    "Failed to advance indexed-search journal checkpoint for {drive_path}: {error}"
                )
            })?;
        Ok(changed == 1)
    }

    pub(in crate::services::indexed_search) fn finish_drive_refresh(
        self,
        drive_path: &str,
        scan_source: &str,
        started_at: u64,
        volume_id: &str,
        journal_checkpoint: Option<JournalCheckpoint>,
        before_commit: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        if volume_id.is_empty() {
            return Err(format!(
                "Cannot finalize indexed-search drive {drive_path} without a volume identity."
            ));
        }
        let completed_at = crate::services::indexed_search::state::now_epoch_ms();
        self.connection
            .execute(
                "INSERT INTO indexed_drive_catalog_state (
                    drive_path,
                    lifecycle_state,
                    last_scan_source,
                    last_scan_started_at,
                    last_scan_completed_at,
                    volume_id,
                    journal_id,
                    journal_next_usn,
                    saved_entry_count
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(drive_path) DO UPDATE SET
                    lifecycle_state = excluded.lifecycle_state,
                    last_scan_source = excluded.last_scan_source,
                    last_scan_started_at = excluded.last_scan_started_at,
                    last_scan_completed_at = excluded.last_scan_completed_at,
                    volume_id = excluded.volume_id,
                    journal_id = excluded.journal_id,
                    journal_next_usn = excluded.journal_next_usn,
                    saved_entry_count = excluded.saved_entry_count",
                params![
                    drive_path,
                    schema::DRIVE_CATALOG_STATE_READY,
                    scan_source,
                    started_at as i64,
                    completed_at as i64,
                    volume_id,
                    journal_checkpoint.map(|checkpoint| checkpoint.journal_id as i64),
                    journal_checkpoint.map(|checkpoint| checkpoint.next_usn),
                    self.entries_written,
                ],
            )
            .map_err(|error| {
                format!("Failed to finalize indexed-search drive state for {drive_path}: {error}")
            })?;
        recursive_build::retire(&self.connection, drive_path)
            .map_err(|error| format!("Failed to retire recursive index progress: {error}"))?;
        before_commit()?;
        self.commit()
    }

    fn commit(mut self) -> Result<(), String> {
        self.connection.execute_batch("COMMIT").map_err(|error| {
            format!("Failed to commit indexed-search write transaction: {error}")
        })?;
        self.finished = true;
        Ok(())
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

#[cfg(test)]
#[path = "writer_tests.rs"]
mod tests;
