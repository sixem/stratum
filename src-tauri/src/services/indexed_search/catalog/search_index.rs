// FTS5 storage and the durable cursor for upgrading an existing catalog.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use super::IndexedCatalogStore;

const BACKFILL_KEY: &str = "ftsTrigramBackfillV1";
const BACKFILL_READY: &str = "ready";
const BATCH_SIZE: usize = 32_768;
const BATCHES_PER_JOB: usize = 4;

const SEARCH_INDEX_SQL: &str = r#"
CREATE VIRTUAL TABLE IF NOT EXISTS indexed_entry_fts USING fts5(
    normalized_name, tokenize = 'trigram', detail = none, content = '', contentless_delete = 1
);

CREATE TRIGGER IF NOT EXISTS indexed_entries_fts_insert AFTER INSERT ON indexed_entries BEGIN
    INSERT INTO indexed_entry_fts(rowid, normalized_name)
    VALUES (new.entry_id, new.normalized_name);
END;

CREATE TRIGGER IF NOT EXISTS indexed_entries_fts_delete AFTER DELETE ON indexed_entries BEGIN
    DELETE FROM indexed_entry_fts WHERE rowid = old.entry_id;
END;

CREATE TRIGGER IF NOT EXISTS indexed_entries_fts_update
AFTER UPDATE OF entry_id, normalized_name ON indexed_entries BEGIN
    DELETE FROM indexed_entry_fts WHERE rowid = old.entry_id;
    INSERT INTO indexed_entry_fts(rowid, normalized_name)
    VALUES (new.entry_id, new.normalized_name);
END;
"#;

enum BackfillState {
    Pending(i64),
    Ready,
}

impl IndexedCatalogStore {
    pub(in crate::services::indexed_search) fn search_index_needs_backfill(
        &self,
    ) -> Result<bool, String> {
        needs_backfill(&self.connect()?)
    }

    pub(in crate::services::indexed_search) fn backfill_search_index_step(
        &self,
        should_cancel: &impl Fn() -> bool,
    ) -> Result<bool, String> {
        backfill(
            &mut self.connect()?,
            BATCH_SIZE,
            BATCHES_PER_JOB,
            should_cancel,
        )
    }

    #[cfg(test)]
    pub(in crate::services::indexed_search) fn backfill_search_index(
        &self,
        should_cancel: &impl Fn() -> bool,
    ) -> Result<bool, String> {
        backfill(&mut self.connect()?, BATCH_SIZE, usize::MAX, should_cancel)
    }
}

pub(super) fn initialize(connection: &Connection) -> Result<(), String> {
    // Install triggers before any backfill so writes to rows on either side of
    // the cursor update FTS in the same transaction as the catalog entries.
    connection
        .execute_batch(SEARCH_INDEX_SQL)
        .map_err(|error| format!("Failed to initialize the indexed-search FTS index: {error}"))?;
    if load_state(connection)?.is_some() {
        return Ok(());
    }

    let has_entries = connection
        .query_row("SELECT EXISTS (SELECT 1 FROM indexed_entries)", [], |row| {
            row.get::<_, bool>(0)
        })
        .map_err(|error| format!("Failed to inspect indexed-search entries: {error}"))?;
    if has_entries {
        save_state(connection, &i64::MIN.to_string())
    } else {
        publish_ready(connection)
    }
}

pub(super) fn needs_backfill(connection: &Connection) -> Result<bool, String> {
    Ok(matches!(
        required_state(connection)?,
        BackfillState::Pending(_)
    ))
}

fn load_state(connection: &Connection) -> Result<Option<BackfillState>, String> {
    let value = connection
        .query_row(
            "SELECT value FROM indexed_catalog_meta WHERE key = ?1",
            [BACKFILL_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| {
            format!("Failed to read the indexed-search FTS migration state: {error}")
        })?;

    value
        .map(|value| {
            if value == BACKFILL_READY {
                Ok(BackfillState::Ready)
            } else {
                value
                    .parse::<i64>()
                    .map(BackfillState::Pending)
                    .map_err(|error| format!("Invalid indexed-search FTS backfill cursor: {error}"))
            }
        })
        .transpose()
}

fn required_state(connection: &Connection) -> Result<BackfillState, String> {
    load_state(connection)?
        .ok_or_else(|| "Indexed-search FTS migration state is missing.".to_string())
}

fn save_state(connection: &Connection, value: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO indexed_catalog_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![BACKFILL_KEY, value],
        )
        .map_err(|error| {
            format!("Failed to save the indexed-search FTS migration state: {error}")
        })?;
    Ok(())
}

fn publish_ready(connection: &Connection) -> Result<(), String> {
    // Drop both legacy B-trees only after FTS covers every entry. SQLite can
    // reuse their pages without compacting the original database on startup.
    connection
        .execute_batch(
            "DROP TABLE IF EXISTS indexed_entry_trigrams;
             DELETE FROM indexed_catalog_meta WHERE key = 'searchTokensReady';",
        )
        .map_err(|error| {
            format!("Failed to remove the retired indexed-search trigram table: {error}")
        })?;
    save_state(connection, BACKFILL_READY)
}

fn backfill(
    connection: &mut Connection,
    batch_size: usize,
    max_batches: usize,
    should_cancel: &impl Fn() -> bool,
) -> Result<bool, String> {
    if !needs_backfill(connection)? {
        return Ok(true);
    }

    for _ in 0..max_batches {
        if should_cancel() {
            break;
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| {
                format!("Failed to start an indexed-search FTS backfill batch: {error}")
            })?;
        let BackfillState::Pending(first_row_id) = required_state(&transaction)? else {
            return Ok(true);
        };

        let last_row_id = transaction
            .query_row(
                "SELECT MAX(entry_id) FROM (
                     SELECT entry_id FROM indexed_entries
                     WHERE entry_id >= ?1 ORDER BY entry_id LIMIT ?2
                 )",
                params![first_row_id, batch_size],
                |row| row.get::<_, Option<i64>>(0),
            )
            .map_err(|error| {
                format!("Failed to find the indexed-search FTS backfill batch: {error}")
            })?;

        if let Some(last_row_id) = last_row_id {
            transaction
                .execute(
                    "INSERT INTO indexed_entry_fts (rowid, normalized_name)
                     SELECT entry.entry_id, entry.normalized_name FROM indexed_entries entry
                     WHERE entry.entry_id BETWEEN ?1 AND ?2
                       AND NOT EXISTS (
                         SELECT 1 FROM indexed_entry_fts fts WHERE fts.rowid = entry.entry_id
                       )
                     ORDER BY entry.entry_id",
                    params![first_row_id, last_row_id],
                )
                .map_err(|error| {
                    format!("Failed to backfill the indexed-search FTS index: {error}")
                })?;
        }

        // The cursor and FTS rows share a commit. An interrupted batch resumes
        // from the last committed cursor, including at the ends of the row-ID range.
        let next_row_id = last_row_id.and_then(|row_id| row_id.checked_add(1));
        match next_row_id {
            Some(row_id) => save_state(&transaction, &row_id.to_string())?,
            None => publish_ready(&transaction)?,
        }
        transaction.commit().map_err(|error| {
            format!("Failed to commit the indexed-search FTS backfill batch: {error}")
        })?;

        if next_row_id.is_none() {
            return Ok(true);
        }
    }

    Ok(false)
}

#[cfg(test)]
#[path = "search_index_tests.rs"]
mod tests;
