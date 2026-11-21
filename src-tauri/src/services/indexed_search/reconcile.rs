// Replace changed subtrees and advance a journal cursor in the same SQLite
// transaction. Physical reads use the captured volume GUID.
use std::path::Path;

use super::{
    catalog::{IndexedCatalogStore, IndexedCatalogWriter},
    scan,
    volume_tracking::VolumeMount,
    work_queue::{coalesce_paths, normalize_path},
};

#[cfg(test)]
use super::journal_batch::{JournalBatch, JournalChangeKind};

// Avoid creating new journal noise just to checkpoint small batches containing
// only content writes or excluded catalog files.
#[cfg(test)]
const JOURNAL_CHECKPOINT_GRANULARITY: i64 = 64 * 1024;

pub(super) enum ReconcileOutcome {
    Cancelled,
    Unchanged,
    NeedsRebuild,
    Committed {
        changed_paths: bool,
        #[cfg(test)]
        pending_renames: bool,
    },
}

pub(super) fn reconcile_paths(
    catalog: &IndexedCatalogStore,
    mount: &VolumeMount,
    paths: Vec<String>,
    should_cancel: &impl Fn() -> bool,
) -> Result<ReconcileOutcome, String> {
    if should_cancel() {
        return Ok(ReconcileOutcome::Cancelled);
    }
    mount.verify()?;
    apply_paths(catalog, mount, paths, None, false, should_cancel, || {
        mount.verify()
    })
}

#[cfg(test)]
pub(super) fn reconcile_journal_batch(
    catalog: &IndexedCatalogStore,
    mount: &VolumeMount,
    batch: JournalBatch,
    should_cancel: &impl Fn() -> bool,
    verify_mount: &impl Fn() -> Result<(), String>,
) -> Result<ReconcileOutcome, String> {
    if should_cancel() {
        return Ok(ReconcileOutcome::Cancelled);
    }
    verify_mount()?;
    let drive = &mount.drive_path;
    let distance = batch.next.next_usn.saturating_sub(batch.previous.next_usn);
    if !batch.has_more
        && distance < JOURNAL_CHECKPOINT_GRANULARITY
        && batch.changes.iter().all(|change| {
            change.kind == JournalChangeKind::Path
                && scan::excluded_path(Path::new(&change.path), catalog.directory())
        })
    {
        return Ok(ReconcileOutcome::Unchanged);
    }

    let mut writer = catalog.begin_write()?;
    if !writer.advance_journal_checkpoint(drive, &mount.identity, batch.previous, batch.next)? {
        return Err("The saved change journal position changed during reconciliation.".to_string());
    }
    let Some(paths) = writer.journal_paths(drive, batch.changes)? else {
        return Ok(ReconcileOutcome::NeedsRebuild);
    };
    let pending_renames = writer.has_pending_renames(drive)?;
    apply_paths(
        catalog,
        mount,
        paths,
        Some(writer),
        pending_renames,
        should_cancel,
        verify_mount,
    )
}

fn apply_paths(
    catalog: &IndexedCatalogStore,
    mount: &VolumeMount,
    paths: Vec<String>,
    journal_writer: Option<IndexedCatalogWriter>,
    _pending_renames: bool,
    should_cancel: &impl Fn() -> bool,
    verify_mount: impl Fn() -> Result<(), String>,
) -> Result<ReconcileOutcome, String> {
    let directory = catalog.directory();
    let Some(paths) = coalesce_paths(
        paths
            .into_iter()
            .filter_map(|path| normalize_path(&path))
            .filter(|(drive, path)| {
                drive == &mount.drive_path
                    && path != drive
                    && !scan::excluded_path(Path::new(path), directory)
            })
            .map(|(_, path)| path)
            .collect(),
    ) else {
        return Ok(ReconcileOutcome::NeedsRebuild);
    };
    // Journal metadata may need to commit even when every path was excluded.
    // An empty ordinary filesystem notification needs no writer at all.
    let mut writer = match journal_writer {
        Some(writer) => writer,
        None if paths.is_empty() => return Ok(ReconcileOutcome::Unchanged),
        None => catalog.begin_write()?,
    };
    if !writer.remove_path_trees(&paths)? {
        return Ok(ReconcileOutcome::NeedsRebuild);
    }

    for path in &paths {
        if should_cancel() {
            return Ok(ReconcileOutcome::Cancelled);
        }
        let physical_path = Path::new(&mount.guid).join(&path[3..]);
        match std::fs::symlink_metadata(&physical_path) {
            Ok(_) => {
                if let Err(error) = scan::scan_path_into_writer(
                    &physical_path,
                    Path::new(path),
                    directory,
                    &mut writer,
                    should_cancel,
                ) {
                    if error == scan::SCAN_CANCELLED_MESSAGE {
                        return Ok(ReconcileOutcome::Cancelled);
                    }
                    return Err(error);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Failed to reconcile indexed-search path {path}: {error}"
                ));
            }
        }
    }
    verify_mount()?;
    if should_cancel() {
        return Ok(ReconcileOutcome::Cancelled);
    }
    writer.finish()?;
    Ok(ReconcileOutcome::Committed {
        changed_paths: !paths.is_empty(),
        #[cfg(test)]
        pending_renames: _pending_renames,
    })
}
