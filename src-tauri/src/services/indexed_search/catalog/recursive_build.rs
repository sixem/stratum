// Durable batches for an unpublished recursive scan. The existing query
// scope accepts only ready drives, so these rows become visible together.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use super::{
    schema::DRIVE_CATALOG_STATE_READY, writer::kind_to_int, CatalogEntryRecord,
    IndexedCatalogStore, JournalCheckpoint,
};
use crate::services::indexed_search::{scan::SCAN_CANCELLED_MESSAGE, state::now_epoch_ms};

const BUILDING: &str = "building";
pub(in crate::services::indexed_search) const CHUNK_SIZE: usize = 2048;

pub(in crate::services::indexed_search) struct RecursiveBuild {
    connection: Connection,
    drive: String,
    volume_id: String,
    attempt: [u8; 16],
    active: Option<String>,
    pub(in crate::services::indexed_search) entries: usize,
    pub(in crate::services::indexed_search) checkpoint: Option<JournalCheckpoint>,
}

impl RecursiveBuild {
    pub(in crate::services::indexed_search) fn open(
        catalog: &IndexedCatalogStore,
        drive: &str,
        volume_id: &str,
        started_at: u64,
        checkpoint: Option<JournalCheckpoint>,
    ) -> Result<Option<Self>, String> {
        if !matches!(drive.as_bytes(), [letter, b':', b'\\'] if letter.is_ascii_uppercase())
            || volume_id.is_empty()
        {
            return Err(
                "Cannot start a recursive index without a drive and its volume identity.".into(),
            );
        }
        let mut attempt = [0u8; 16];
        getrandom::fill(&mut attempt).map_err(|error| error.to_string())?;
        let mut connection = catalog.connect()?;
        // WAL stays durable across app restarts without flushing the device
        // for every small directory. The startup schema uses the same mode.
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(database_error)?;
        let (active, entries, checkpoint) = {
            let tx = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(database_error)?;
            let state: Option<(String, Option<String>, Option<i64>, Option<i64>)> = tx
                .query_row(
                    "SELECT lifecycle_state, volume_id, journal_id, journal_next_usn
                     FROM indexed_drive_catalog_state WHERE drive_path = ?1",
                    [drive],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()
                .map_err(database_error)?;
            if state
                .as_ref()
                .is_some_and(|(state, ..)| state == DRIVE_CATALOG_STATE_READY)
            {
                return Ok(None);
            }
            let prior_checkpoint = state.as_ref().and_then(|(_, _, id, usn)| {
                Some(JournalCheckpoint {
                    journal_id: (*id)? as u64,
                    next_usn: (*usn)?,
                })
            });
            // Keep the cursor from before the first directory was scanned.
            // A newly available or replaced journal requires a new baseline.
            let can_resume = state.as_ref().is_some_and(|(state, id, ..)| {
                state == BUILDING && id.as_deref() == Some(volume_id)
            }) && checkpoint.is_none_or(|current| {
                prior_checkpoint.is_some_and(|saved| saved.journal_id == current.journal_id)
            });
            let prior: Option<(Option<String>, usize)> = if can_resume {
                tx.query_row(
                    "SELECT active_dir, completed_entries FROM indexed_recursive_builds WHERE drive_path = ?1",
                    [drive],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(database_error)?
            } else {
                None
            };
            let (active, entries, checkpoint) = if let Some((active, entries)) = prior {
                tx.execute(
                    "UPDATE indexed_recursive_builds SET attempt = ?2 WHERE drive_path = ?1",
                    params![drive, attempt.as_slice()],
                )
                .map_err(database_error)?;
                (active, entries, prior_checkpoint)
            } else {
                tx.execute(
                    "INSERT INTO indexed_drive_catalog_state (
                        drive_path, lifecycle_state, volume_id, last_scan_started_at,
                        journal_id, journal_next_usn
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                    ON CONFLICT(drive_path) DO UPDATE SET
                        lifecycle_state = excluded.lifecycle_state,
                        volume_id = excluded.volume_id,
                        last_scan_started_at = excluded.last_scan_started_at,
                        last_scan_completed_at = NULL, last_scan_source = NULL,
                        journal_id = excluded.journal_id, journal_next_usn = excluded.journal_next_usn,
                        saved_entry_count = NULL",
                    params![
                        drive, BUILDING, volume_id, started_at,
                        checkpoint.map(|cursor| cursor.journal_id as i64),
                        checkpoint.map(|cursor| cursor.next_usn),
                    ],
                )
                .map_err(database_error)?;
                tx.execute(
                    "INSERT INTO indexed_recursive_builds VALUES (?1, ?2, '', 0)
                     ON CONFLICT(drive_path) DO UPDATE SET
                        attempt = excluded.attempt, active_dir = '', completed_entries = 0",
                    params![drive, attempt.as_slice()],
                )
                .map_err(database_error)?;
                tx.execute(
                    "INSERT OR IGNORE INTO indexed_recursive_directories VALUES (?1, '')",
                    [drive],
                )
                .map_err(database_error)?;
                tx.execute(
                    "DELETE FROM indexed_pending_renames WHERE drive_path = ?1",
                    [drive],
                )
                .map_err(database_error)?;
                // An empty relative path is the drive root. Cleanup discards
                // any old or orphaned partial rows before beginning there.
                (Some(String::new()), 0, checkpoint)
            };
            tx.commit().map_err(database_error)?;
            (active, entries, checkpoint)
        };
        Ok(Some(Self {
            connection,
            drive: drive.to_owned(),
            volume_id: volume_id.to_owned(),
            attempt,
            active,
            entries,
            checkpoint,
        }))
    }

    pub(in crate::services::indexed_search) fn clear_interrupted_directory(
        &mut self,
        should_cancel: &impl Fn() -> bool,
    ) -> Result<(), String> {
        let Some(active) = self.active.as_deref() else {
            return Ok(());
        };
        // Children of an incomplete directory have never been traversed.
        // Remove only its partial discoveries before enumerating it again.
        let folder = format!("{}{active}", self.drive);
        let mut lower_drive = folder.clone();
        lower_drive[..1].make_ascii_lowercase();
        let first = [folder, lower_drive].map(|path| path.trim_end_matches('\\').to_owned());
        let bounds = first.map(|path| (format!("{path}\\"), format!("{path}]")));
        let discovered_children = if active.is_empty() {
            ("relative_path > ''", String::new(), String::new())
        } else {
            (
                "relative_path > ?2 AND relative_path < ?3",
                format!("{active}\\"),
                format!("{active}]"),
            )
        };
        let delete_children = format!(
            "DELETE FROM indexed_recursive_directories
             WHERE (drive_path, relative_path) IN (
                 SELECT drive_path, relative_path FROM indexed_recursive_directories
                 WHERE drive_path = ?1 AND {} LIMIT ?4
             )",
            discovered_children.0
        );
        loop {
            if should_cancel() {
                return Err(SCAN_CANCELLED_MESSAGE.into());
            }
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(database_error)?;
            ensure_owned(&tx, &self.drive, &self.volume_id, &self.attempt)?;
            let mut removed = 0;
            for (start, end) in &bounds {
                removed += tx
                    .execute(
                        "DELETE FROM indexed_entries WHERE path IN (
                         SELECT path FROM indexed_entries WHERE path >= ?1 AND path < ?2 LIMIT ?3
                     )",
                        params![start, end, CHUNK_SIZE],
                    )
                    .map_err(database_error)?;
            }
            removed += tx
                .execute(
                    &delete_children,
                    params![
                        self.drive,
                        discovered_children.1,
                        discovered_children.2,
                        CHUNK_SIZE
                    ],
                )
                .map_err(database_error)?;
            tx.commit().map_err(database_error)?;
            if removed == 0 {
                return Ok(());
            }
        }
    }

    pub(in crate::services::indexed_search) fn next_directory(
        &self,
    ) -> Result<Option<String>, String> {
        ensure_owned(
            &self.connection,
            &self.drive,
            &self.volume_id,
            &self.attempt,
        )?;
        if let Some(active) = &self.active {
            return Ok(Some(active.clone()));
        }
        self.connection
            .query_row(
                "SELECT relative_path FROM indexed_recursive_directories
             WHERE drive_path = ?1 ORDER BY relative_path LIMIT 1",
                [&self.drive],
                |row| row.get(0),
            )
            .optional()
            .map_err(database_error)
    }

    pub(in crate::services::indexed_search) fn write_chunk(
        &mut self,
        directory: &str,
        records: &[CatalogEntryRecord],
        children: &[String],
        entries_in_directory: usize,
        finished: bool,
    ) -> Result<usize, String> {
        if records.len() > CHUNK_SIZE || children.len() > CHUNK_SIZE {
            return Err("Recursive index batch exceeded its size limit.".into());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        ensure_owned(&tx, &self.drive, &self.volume_id, &self.attempt)?;
        let inserted = {
            let mut insert = tx.prepare_cached(
                "INSERT OR IGNORE INTO indexed_entries (path, normalized_name, kind, size_bytes)
                 VALUES (?1, ?2, ?3, ?4)",
            ).map_err(database_error)?;
            let mut pending = tx
                .prepare_cached(
                    "INSERT OR IGNORE INTO indexed_recursive_directories VALUES (?1, ?2)",
                )
                .map_err(database_error)?;
            let mut inserted = 0;
            for record in records {
                inserted += insert
                    .execute(params![
                        record.path,
                        record.normalized_name,
                        kind_to_int(record.kind),
                        record.size_bytes
                    ])
                    .map_err(database_error)?;
            }
            for child in children {
                pending
                    .execute(params![self.drive, child])
                    .map_err(database_error)?;
            }
            inserted
        };
        let completed = if finished {
            tx.execute(
                "DELETE FROM indexed_recursive_directories WHERE drive_path = ?1 AND relative_path = ?2",
                params![self.drive, directory],
            ).map_err(database_error)?;
            self.entries
                .saturating_add(entries_in_directory)
                .saturating_add(inserted)
        } else {
            self.entries
        };
        let active = (!finished).then_some(directory);
        tx.execute(
            "UPDATE indexed_recursive_builds SET active_dir = ?2, completed_entries = ?3 WHERE drive_path = ?1",
            params![self.drive, active, completed],
        ).map_err(database_error)?;
        tx.commit().map_err(database_error)?;
        self.active = active.map(str::to_owned);
        self.entries = completed;
        Ok(inserted)
    }

    pub(in crate::services::indexed_search) fn publish(
        &mut self,
        source: &str,
        verify: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        ensure_owned(&tx, &self.drive, &self.volume_id, &self.attempt)?;
        let pending: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM indexed_recursive_directories WHERE drive_path = ?1)",
                [&self.drive],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if pending {
            return Err("Cannot publish an index with pending directories.".into());
        }
        tx.execute(
            "UPDATE indexed_drive_catalog_state SET lifecycle_state = ?2, last_scan_source = ?3,
                 last_scan_completed_at = ?4, saved_entry_count = ?5 WHERE drive_path = ?1",
            params![
                self.drive,
                DRIVE_CATALOG_STATE_READY,
                source,
                now_epoch_ms(),
                self.entries
            ],
        )
        .map_err(database_error)?;
        retire(&tx, &self.drive).map_err(database_error)?;
        verify()?;
        tx.commit().map_err(database_error)
    }
}

fn ensure_owned(
    connection: &Connection,
    drive: &str,
    volume_id: &str,
    attempt: &[u8],
) -> Result<(), String> {
    let current: bool = connection
        .query_row(
            "SELECT EXISTS(
            SELECT 1 FROM indexed_recursive_builds build
            JOIN indexed_drive_catalog_state drive USING (drive_path)
            WHERE drive_path = ?1 AND drive.volume_id = ?2 AND build.attempt = ?3
              AND drive.lifecycle_state = ?4
        )",
            params![drive, volume_id, attempt, BUILDING],
            |row| row.get(0),
        )
        .map_err(database_error)?;
    if !current {
        return Err(SCAN_CANCELLED_MESSAGE.into());
    }
    Ok(())
}

pub(super) fn retire(connection: &Connection, drive: &str) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM indexed_recursive_directories WHERE drive_path = ?1",
        [drive],
    )?;
    connection.execute(
        "DELETE FROM indexed_recursive_builds WHERE drive_path = ?1",
        [drive],
    )?;
    Ok(())
}

fn database_error(error: rusqlite::Error) -> String {
    format!("Could not save recursive index progress: {error}")
}

#[cfg(test)]
#[path = "recursive_build_tests.rs"]
mod tests;
