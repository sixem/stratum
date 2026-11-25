// Fill in a small part of a saved volume without changing its search rows or scan state.
use std::{
    fs::File,
    path::{Path, PathBuf},
};

use rusqlite::{params, Connection, TransactionBehavior};

use crate::platform::windows::file_names::plain_component;

use super::{
    super::{
        resumable_scan::open_frontier, volume_tracking::VolumeMount,
        watched_paths::listed_file_size,
    },
    schema::{self, DRIVE_CATALOG_STATE_READY},
    IndexedCatalogStore,
};

const ROWS_PER_BATCH: usize = 64;

#[derive(Default)]
pub(in crate::services::indexed_search) struct SizeBackfillStep {
    pub(in crate::services::indexed_search) changed: bool,
    pub(in crate::services::indexed_search) reschedule: bool,
}

struct Progress {
    drive: String,
    after_path: String,
}

struct Candidate {
    id: i64,
    path: String,
    needs_size: bool,
}

impl IndexedCatalogStore {
    pub(in crate::services::indexed_search) fn backfill_file_sizes_step(
        &self,
        mounts: &[VolumeMount],
        should_cancel: &impl Fn() -> bool,
    ) -> Result<SizeBackfillStep, String> {
        if should_cancel() {
            return Ok(SizeBackfillStep::default());
        }
        let mut connection = self.connect()?;
        // Build the partial index on the low-priority worker. On the first
        // legacy run it is mostly empty, and subsequent chunks maintain it.
        schema::create_size_index(&connection)?;
        let plans = pending_drives(&connection).map_err(database_error)?;
        for plan in plans {
            let Some(mount) = mounts
                .iter()
                .find(|mount| mount.drive_path.eq_ignore_ascii_case(&plan.drive))
            else {
                continue;
            };
            if mount.verify().is_err() {
                continue;
            }
            let volume = Path::new(&mount.guid);
            let mut reader = SizeReader::default();
            return backfill_drive(
                &mut connection,
                &plan,
                &mount.identity,
                move |path| reader.read(volume, path),
                should_cancel,
                || mount.verify().is_ok(),
            );
        }
        Ok(SizeBackfillStep::default())
    }
}

fn pending_drives(connection: &Connection) -> rusqlite::Result<Vec<Progress>> {
    let mut select = connection
        .prepare("SELECT drive_path, after_path FROM indexed_size_backfills ORDER BY drive_path")?;
    let rows = select.query_map([], |row| {
        Ok(Progress {
            drive: row.get(0)?,
            after_path: row.get(1)?,
        })
    })?;
    rows.collect()
}

fn load_candidates(connection: &Connection, plan: &Progress) -> rusqlite::Result<Vec<Candidate>> {
    let mut candidates = Vec::with_capacity(ROWS_PER_BATCH);
    let [letter, b':', b'\\'] = plan.drive.as_bytes() else {
        return Ok(candidates);
    };
    if !letter.is_ascii_alphabetic() {
        return Ok(candidates);
    }
    let mut select = connection.prepare(
        "SELECT entry_id, path, kind = 0 AND size_bytes IS NULL FROM indexed_entries
         WHERE path > ?1 AND path < ?2 ORDER BY path LIMIT ?3",
    )?;
    // A LIMIT on the path range, before selecting unknown sizes in Rust,
    // bounds SQLite work even when the remaining rows already have sizes.
    for letter in [letter.to_ascii_uppercase(), letter.to_ascii_lowercase()] {
        let letter = char::from(letter);
        let first = format!("{letter}:\\");
        let end = format!("{letter}:]");
        let start = plan.after_path.as_str().max(first.as_str());
        if start >= end.as_str() {
            continue;
        }
        let rows = select.query_map(
            params![start, end, ROWS_PER_BATCH - candidates.len()],
            |row| {
                Ok(Candidate {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    needs_size: row.get(2)?,
                })
            },
        )?;
        for row in rows {
            candidates.push(row?);
        }
        if candidates.len() == ROWS_PER_BATCH {
            break;
        }
    }
    Ok(candidates)
}

fn backfill_drive(
    connection: &mut Connection,
    plan: &Progress,
    volume_id: &str,
    mut read_size: impl FnMut(&str) -> Option<i64>,
    should_cancel: &impl Fn() -> bool,
    verify_mount: impl FnOnce() -> bool,
) -> Result<SizeBackfillStep, String> {
    let candidates = load_candidates(connection, plan).map_err(database_error)?;
    let mut sizes = Vec::new();
    for candidate in &candidates {
        if should_cancel() {
            return Ok(SizeBackfillStep::default());
        }
        if candidate.needs_size {
            if let Some(size) = read_size(&candidate.path[3..]) {
                sizes.push((candidate, size));
            }
        }
    }
    drop(read_size);
    if should_cancel() || !verify_mount() {
        return Ok(SizeBackfillStep::default());
    }
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;
    let snapshot_matches = tx
        .query_row(
            "SELECT EXISTS (
            SELECT 1 FROM indexed_drive_catalog_state WHERE drive_path = ?1 COLLATE NOCASE
            AND volume_id = ?2 AND lifecycle_state = ?3
         )",
            params![plan.drive, volume_id, DRIVE_CATALOG_STATE_READY],
            |row| row.get::<_, bool>(0),
        )
        .map_err(database_error)?;
    if !snapshot_matches {
        return Ok(SizeBackfillStep::default());
    }
    let advance = if candidates.len() == ROWS_PER_BATCH {
        let last = &candidates.last().expect("full batch").path;
        tx.execute(
            "UPDATE indexed_size_backfills SET after_path = ?3 WHERE drive_path = ?1 AND after_path = ?2",
            params![plan.drive, plan.after_path, last],
        )
    } else {
        tx.execute(
            "DELETE FROM indexed_size_backfills WHERE drive_path = ?1 AND after_path = ?2",
            params![plan.drive, plan.after_path],
        )
    }.map_err(database_error)?;
    if advance == 0 {
        return Ok(SizeBackfillStep::default());
    }
    let mut changed = false;
    {
        let mut update = tx
            .prepare(
                "UPDATE indexed_entries SET size_bytes = ?3
             WHERE entry_id = ?1 AND path = ?2 AND kind = 0 AND size_bytes IS NULL",
            )
            .map_err(database_error)?;
        for (candidate, size) in sizes {
            changed |= update
                .execute(params![candidate.id, candidate.path, size])
                .map_err(database_error)?
                > 0;
        }
    }
    // A failed metadata lookup is deliberately passed by the cursor. A future
    // change notification can supply the size when the file becomes accessible.
    if should_cancel() {
        return Ok(SizeBackfillStep::default());
    }
    tx.commit().map_err(database_error)?;
    Ok(SizeBackfillStep {
        changed,
        reschedule: true,
    })
}

#[derive(Default)]
struct SizeReader {
    parent: String,
    opened: Option<(PathBuf, Vec<File>, usize)>,
}

impl SizeReader {
    fn read(&mut self, volume: &Path, relative: &str) -> Option<i64> {
        let (parent, name) = relative.rsplit_once('\\').unwrap_or(("", relative));
        if !plain_component(name) {
            return None;
        }
        if parent.is_empty() {
            self.opened = None;
            self.parent.clear();
            return listed_file_size(&volume.join(name));
        }
        if self.parent != parent {
            // Keep ancestors pinned only while reading this folder at a time.
            self.opened = None;
            self.parent = parent.to_owned();
            self.opened = open_frontier(volume, parent);
        }
        let (path, _ancestors, _) = self.opened.as_ref()?;
        listed_file_size(&path.join(name))
    }
}

fn database_error(error: rusqlite::Error) -> String {
    format!("Indexed-search file size backfill failed: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TempDirectory(PathBuf);

    impl TempDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "stratum-size-backfill-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn existing_catalog_keeps_entry_ids_and_resumes_missing_sizes_after_reopen() {
        let scratch = TempDirectory::new();
        let path = scratch.0.join("catalog.sqlite3");
        let legacy = Connection::open(&path).unwrap();
        legacy
            .execute_batch(
                r"
            CREATE TABLE indexed_entries (
                entry_id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE,
                normalized_name TEXT NOT NULL, kind INTEGER NOT NULL
            );
            CREATE TABLE indexed_drive_catalog_state (
                drive_path TEXT PRIMARY KEY, lifecycle_state TEXT NOT NULL, volume_id TEXT
            );
            INSERT INTO indexed_drive_catalog_state VALUES ('C:\', 'ready', 'vol');
            INSERT INTO indexed_entries VALUES (200, 'c:\empty.txt', 'empty.txt', 0);
            INSERT INTO indexed_entries VALUES (201, 'C:\folder', 'folder', 1);
            INSERT INTO indexed_entries VALUES (202, 'D:\other.txt', 'other.txt', 0);
        ",
            )
            .unwrap();
        for index in 0..ROWS_PER_BATCH {
            legacy
                .execute(
                    "INSERT INTO indexed_entries VALUES (?1, ?2, 'old.txt', 0)",
                    params![index + 1, format!(r"C:\a-{index:03}.txt")],
                )
                .unwrap();
        }
        drop(legacy);

        let store = IndexedCatalogStore::open(path.clone()).unwrap();
        let mut connection = store.connect().unwrap();
        let plan = pending_drives(&connection).unwrap().pop().unwrap();
        assert!(plan.after_path.is_empty());
        // Refuse to publish if the drive assignment changed while reading disk.
        let moved = backfill_drive(
            &mut connection,
            &plan,
            "vol",
            |_| Some(7),
            &|| false,
            || false,
        )
        .unwrap();
        assert!(!moved.changed);
        assert!(pending_drives(&connection).unwrap()[0]
            .after_path
            .is_empty());
        let first = backfill_drive(
            &mut connection,
            &plan,
            "vol",
            |name| (name == "a-000.txt").then_some(7),
            &|| false,
            || true,
        )
        .unwrap();
        assert!(first.changed && first.reschedule);
        drop(connection);
        drop(store);

        let reopened = IndexedCatalogStore::open(path).unwrap();
        let mut connection = reopened.connect().unwrap();
        let plan = pending_drives(&connection).unwrap().pop().unwrap();
        assert_eq!(
            plan.after_path,
            format!(r"C:\a-{:03}.txt", ROWS_PER_BATCH - 1)
        );
        let second = backfill_drive(
            &mut connection,
            &plan,
            "vol",
            |name| {
                assert_eq!(name, "empty.txt");
                Some(0)
            },
            &|| false,
            || true,
        )
        .unwrap();
        assert!(second.changed);
        assert!(pending_drives(&connection).unwrap().is_empty());
        for (id, size) in [
            (1, Some(7i64)),
            (2, None),
            (200, Some(0)),
            (201, None),
            (202, None),
        ] {
            assert_eq!(
                connection
                    .query_row(
                        "SELECT size_bytes FROM indexed_entries WHERE entry_id = ?1",
                        [id],
                        |row| row.get::<_, Option<i64>>(0),
                    )
                    .unwrap(),
                size
            );
        }
    }
}
