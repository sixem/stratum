// Keep old names across checkpoints. A rename's source and destination enter
// the catalog together, even when other files change between its two records.
use rusqlite::{params, OptionalExtension};

#[cfg(test)]
use super::IndexedCatalogStore;
use super::IndexedCatalogWriter;
use crate::services::indexed_search::journal_batch::{JournalChangeKind, JournalPathChange};

const HAS_PENDING: &str = "SELECT 1 FROM indexed_pending_renames WHERE drive_path = ?1 LIMIT 1";
const SAVE_OLD: &str = "INSERT INTO indexed_pending_renames (drive_path, file_id, old_parent_id, old_path)
    VALUES (?1, ?2, ?3, ?4) ON CONFLICT(drive_path, file_id) DO UPDATE
    SET old_path = excluded.old_path WHERE old_parent_id = excluded.old_parent_id AND old_path = excluded.old_path";
const TAKE_OLD: &str = "DELETE FROM indexed_pending_renames WHERE drive_path = ?1 AND file_id = ?2
    RETURNING old_parent_id, old_path";

#[cfg(test)]
impl IndexedCatalogStore {
    pub(in crate::services::indexed_search) fn has_pending_renames(
        &self,
        drive: &str,
    ) -> Result<bool, String> {
        self.connect()?
            .prepare(HAS_PENDING)
            .and_then(|mut query| query.exists([drive]))
            .map_err(|error| format!("Failed to check pending renames for {drive}: {error}"))
    }
}

impl IndexedCatalogWriter {
    pub(in crate::services::indexed_search) fn has_pending_renames(
        &self,
        drive: &str,
    ) -> Result<bool, String> {
        self.connection
            .prepare_cached(HAS_PENDING)
            .and_then(|mut query| query.exists([drive]))
            .map_err(|error| format!("Failed to check pending renames for {drive}: {error}"))
    }

    pub(in crate::services::indexed_search) fn journal_paths(
        &self,
        drive: &str,
        changes: Vec<JournalPathChange>,
    ) -> Result<Option<Vec<String>>, String> {
        let mut paths = Vec::with_capacity(changes.len());
        for change in changes {
            match change.kind {
                JournalChangeKind::Path => {}
                JournalChangeKind::RenameOld(file_id) => {
                    // Identical old-name records are harmless. A second,
                    // different source for an unmatched file ID is ambiguous.
                    let recorded = self
                        .connection
                        .prepare_cached(SAVE_OLD)
                        .and_then(|mut save| {
                            save.execute(params![
                                drive,
                                file_id as i64,
                                change.parent_file_id as i64,
                                change.path
                            ])
                        })
                        .map_err(|error| {
                            format!("Failed to save a pending rename for {drive}: {error}")
                        })?;
                    if recorded == 0 {
                        return Ok(None);
                    }
                    continue;
                }
                JournalChangeKind::RenameNew(file_id) => {
                    // A CLOSE record can repeat a destination. A scan can also
                    // capture its starting checkpoint between the two records.
                    let old: Option<(i64, String)> = self
                        .connection
                        .prepare_cached(TAKE_OLD)
                        .and_then(|mut take| {
                            take.query_row(params![drive, file_id as i64], |row| {
                                Ok((row.get(0)?, row.get(1)?))
                            })
                            .optional()
                        })
                        .map_err(|error| {
                            format!("Failed to finish a pending rename for {drive}: {error}")
                        })?;
                    if let Some((old_parent_id, old_path)) = old {
                        // A parent can move between journal reads. Its file ID
                        // still identifies an in-place change to the child's name.
                        let same_parent = old_parent_id as u64 == change.parent_file_id;
                        if ambiguous_rename(&old_path, &change.path)
                            || (same_parent
                                && ambiguous_rename(file_name(&old_path), file_name(&change.path)))
                        {
                            return Ok(None);
                        }
                        paths.push(old_path);
                    }
                }
            }
            paths.push(change.path);
        }
        Ok(Some(paths))
    }
}

fn file_name(path: &str) -> &str {
    path.rsplit_once('\\').map_or(path, |(_, name)| name)
}

fn ambiguous_rename(old: &str, new: &str) -> bool {
    if old == new {
        return false;
    }
    if old.is_ascii() && new.is_ascii() {
        return old.eq_ignore_ascii_case(new);
    }
    #[cfg(target_os = "windows")]
    {
        // Use Windows' ordinal comparison for non-ASCII names, e.g. å and Å.
        // If comparison fails, the spelling must be verified by a drive scan.
        use windows_sys::Win32::Globalization::{CompareStringOrdinal, CSTR_EQUAL};
        let old: Vec<_> = old.encode_utf16().collect();
        let new: Vec<_> = new.encode_utf16().collect();
        let result = unsafe {
            CompareStringOrdinal(
                old.as_ptr(),
                old.len() as i32,
                new.as_ptr(),
                new.len() as i32,
                1,
            )
        };
        matches!(result, 0 | CSTR_EQUAL)
    }
    #[cfg(not(target_os = "windows"))]
    {
        old.to_uppercase() == new.to_uppercase()
    }
}
