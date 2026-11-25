// Reconcile the nameless NTFS feed with directory listings from the user token.
#[path = "user_journal_directories.rs"]
mod directories;

use std::{
    collections::{BTreeMap, HashSet},
    io,
    path::Path,
};

use crate::domain::indexed_search::IndexedEntryKind;
use windows_sys::Win32::System::Ioctl::USN_REASON_SECURITY_CHANGE;

use super::{
    catalog::{CatalogChild, CatalogEntryRecord, IndexedCatalogStore, IndexedCatalogWriter},
    scan::{excluded_path, SCAN_CANCELLED_MESSAGE},
    volume_tracking::VolumeMount,
    windows_user_journal::{open_directory_resolver, ResolvedDirectory, UserJournalBatch},
};
use directories::{open_scoped_directory, DirectoryEntry};

// Avoid writing the WAL in response to its own namespace events.
const CHECKPOINT_GRANULARITY: i64 = 64 * 1024;
const INSERT_BATCH_SIZE: usize = 2048;

pub(super) enum UserReconcileOutcome {
    Cancelled,
    Unchanged,
    Committed {
        changed_paths: bool,
        entry_count: Option<usize>,
    },
}

#[derive(Default)]
struct ParentChanges {
    directories: HashSet<u64>,
    access_changed: bool,
    compare_namespace: bool,
    sized_files: HashSet<u64>,
}

#[derive(Default)]
struct ReconcilePlan {
    paths: BTreeMap<String, Option<DirectoryEntry>>,
    sizes: BTreeMap<String, Option<i64>>,
}

pub(super) fn reconcile_user_journal_batch(
    catalog: &IndexedCatalogStore,
    mount: &VolumeMount,
    batch: UserJournalBatch,
    should_cancel: &impl Fn() -> bool,
) -> Result<UserReconcileOutcome, String> {
    match reconcile(catalog, mount, batch, should_cancel) {
        Err(_) if should_cancel() => Ok(UserReconcileOutcome::Cancelled),
        outcome => outcome,
    }
}

fn reconcile(
    catalog: &IndexedCatalogStore,
    mount: &VolumeMount,
    batch: UserJournalBatch,
    should_cancel: &impl Fn() -> bool,
) -> Result<UserReconcileOutcome, String> {
    check_cancelled(should_cancel)?;
    mount.verify()?;
    let small_batch = !batch.has_more
        && batch.next.next_usn.saturating_sub(batch.previous.next_usn) < CHECKPOINT_GRANULARITY;
    if small_batch && batch.changes.is_empty() {
        return Ok(UserReconcileOutcome::Unchanged);
    }

    let mut parents: BTreeMap<u64, ParentChanges> = BTreeMap::new();
    for change in batch.changes {
        if change.is_size_only() {
            if !change.is_dir {
                parents
                    .entry(change.parent_file_id)
                    .or_default()
                    .sized_files
                    .insert(change.file_id);
            }
            continue;
        }
        let changed = parents.entry(change.parent_file_id).or_default();
        changed.compare_namespace = true;
        if change.is_dir {
            changed.directories.insert(change.file_id);
            // Changing a parent ACL can revoke access to its descendants,
            // even if it still has the same name in the catalog.
            changed.access_changed |= change.file_id == change.parent_file_id
                && change.reason & USN_REASON_SECURITY_CHANGE != 0;
        }
    }

    let excluded = catalog.directory();
    let mut writer = None;
    let mut plan = ReconcilePlan::default();
    if !parents.is_empty() {
        let resolver = open_directory_resolver(&mount.guid)?;
        for (parent_id, changed) in parents {
            check_cancelled(should_cancel)?;
            let parent = match resolver.resolve(parent_id)? {
                ResolvedDirectory::Path(path) => path,
                // A removed or redirected parent is accounted for by the
                // namespace change in its own containing directory.
                ResolvedDirectory::Missing
                | ResolvedDirectory::Excluded
                | ResolvedDirectory::Inaccessible => continue,
            };
            let Some(relative) = parent.strip_prefix('\\') else {
                return Err("Invalid path from the indexed-search directory resolver.".into());
            };
            let logical = format!("{}{relative}", mount.drive_path);
            if excluded_path(Path::new(&logical), excluded) {
                continue;
            }
            let directory =
                open_scoped_directory(Path::new(&mount.guid), relative).map_err(directory_error)?;
            let entries = match directory {
                Some(directory) if directory.file_id().map_err(directory_error)? == parent_id => {
                    directory.entries(should_cancel).map_err(directory_error)?
                }
                // The path disappeared, was replaced, or is inaccessible
                // under normal access checks. A visible parent entry stays
                // indexed by its containing directory, but no stale children do.
                None if !relative.is_empty() => Vec::new(),
                _ => continue,
            };
            if changed.compare_namespace {
                // Opening a SQLite writer can create WAL files. Skip inaccessible
                // and excluded parents before taking the writer transaction.
                let catalog_writer = match &mut writer {
                    Some(writer) => writer,
                    slot @ None => slot.insert(catalog.begin_write()?),
                };
                let existing = catalog_writer.indexed_children(&logical)?;
                plan_children(&logical, existing, entries, changed, excluded, &mut plan);
            } else {
                // Data writes leave paths unchanged. The IDs identify the
                // affected files without querying the other catalog children.
                let prefix = directory_prefix(&logical);
                for entry in entries {
                    if entry.kind == IndexedEntryKind::File
                        && changed.sized_files.contains(&entry.file_id)
                    {
                        let path = format!("{prefix}{}", entry.name);
                        if !excluded_path(Path::new(&path), excluded) {
                            plan.sizes.insert(path, entry.size_bytes);
                        }
                    }
                }
            }
        }
    }

    // Persist a comparison of any real parent even if its entries already
    // matched, so idle volumes don't keep relisting the same directories.
    if small_batch && writer.is_none() && plan.sizes.is_empty() {
        return Ok(UserReconcileOutcome::Unchanged);
    }
    let mut writer = match writer {
        Some(writer) => writer,
        None => catalog.begin_write()?,
    };
    if !writer.advance_journal_checkpoint(
        &mount.drive_path,
        &mount.identity,
        batch.previous,
        batch.next,
    )? {
        return Err("The saved change journal position changed during reconciliation.".to_owned());
    }

    let mut covered = HashSet::new();
    let mut removed = 0;
    for (path, entry) in plan.paths {
        check_cancelled(should_cancel)?;
        // A move can produce changes both in a directory and in one of
        // its parents. Once the parent subtree is replaced, skip its children.
        if covered_by(&covered, &path) {
            continue;
        }
        removed += writer.remove_exact_path_tree(&path)?;
        if let Some(entry) = entry {
            insert_tree(&mut writer, mount, &path, entry, excluded, should_cancel)?;
        }
        covered.insert(path);
    }

    let entry_count = if !covered.is_empty() {
        writer.adjust_saved_entry_count(&mount.drive_path, removed)?
    } else {
        None
    };
    let mut changed_paths = !covered.is_empty();
    for (path, size_bytes) in plan.sizes {
        check_cancelled(should_cancel)?;
        if !covered_by(&covered, &path) {
            // A size-only update preserves the entry ID and FTS row.
            changed_paths |= writer.update_file_size(&path, size_bytes)?;
        }
    }
    mount.verify()?;
    check_cancelled(should_cancel)?;
    writer.finish()?;
    Ok(UserReconcileOutcome::Committed {
        changed_paths,
        entry_count,
    })
}

fn covered_by(paths: &HashSet<String>, path: &str) -> bool {
    paths.contains(path)
        || path
            .rmatch_indices('\\')
            .take_while(|(end, _)| *end > 2)
            .any(|(end, _)| paths.contains(&path[..end]))
}

fn directory_prefix(parent: &str) -> String {
    if parent.ends_with('\\') {
        parent.to_owned()
    } else {
        format!("{parent}\\")
    }
}

fn plan_children(
    parent: &str,
    existing: BTreeMap<String, Option<CatalogChild>>,
    entries: Vec<DirectoryEntry>,
    changed: ParentChanges,
    excluded: Option<&Path>,
    plan: &mut ReconcilePlan,
) {
    let mut existing = existing;
    let prefix = directory_prefix(parent);
    for entry in entries {
        let path = format!("{prefix}{}", entry.name);
        if excluded_path(Path::new(&path), excluded) {
            existing.remove(&entry.name);
            continue;
        }
        let previous = existing.remove(&entry.name).flatten();
        let refresh_directory = entry.kind == IndexedEntryKind::Directory
            && (changed.access_changed || changed.directories.contains(&entry.file_id));
        if previous.is_none_or(|old| old.kind != entry.kind) || refresh_directory {
            plan.paths.insert(path, Some(entry));
        } else if entry.kind == IndexedEntryKind::File
            && previous.is_some_and(|old| old.size_bytes != entry.size_bytes)
        {
            plan.sizes.insert(path, entry.size_bytes);
        }
    }
    for name in existing.into_keys() {
        plan.paths.insert(format!("{prefix}{name}"), None);
    }
}

fn insert_tree(
    writer: &mut IndexedCatalogWriter,
    mount: &VolumeMount,
    path: &str,
    entry: DirectoryEntry,
    excluded: Option<&Path>,
    should_cancel: &impl Fn() -> bool,
) -> Result<(), String> {
    let mut batch = Vec::new();
    add_record(&mut batch, path, &entry);
    let mut directories = Vec::new();
    if entry.can_descend {
        directories.push((path.to_owned(), entry.file_id));
    }
    while let Some((path, file_id)) = directories.pop() {
        check_cancelled(should_cancel)?;
        let relative = &path[mount.drive_path.len()..];
        let Some(directory) =
            open_scoped_directory(Path::new(&mount.guid), relative).map_err(directory_error)?
        else {
            continue;
        };
        if directory.file_id().map_err(directory_error)? != file_id {
            continue;
        }
        for entry in directory.entries(should_cancel).map_err(directory_error)? {
            let child = format!("{path}\\{}", entry.name);
            if excluded_path(Path::new(&child), excluded) {
                continue;
            }
            add_record(&mut batch, &child, &entry);
            if batch.len() == INSERT_BATCH_SIZE {
                check_cancelled(should_cancel)?;
                writer.insert_batch(&batch)?;
                batch.clear();
            }
            if entry.can_descend {
                directories.push((child, entry.file_id));
            }
        }
    }
    writer.insert_batch(&batch)
}

fn add_record(batch: &mut Vec<CatalogEntryRecord>, path: &str, entry: &DirectoryEntry) {
    if let Some(record) =
        CatalogEntryRecord::from_path(Path::new(path), entry.kind, entry.size_bytes)
    {
        batch.push(record);
    }
}

fn check_cancelled(should_cancel: &impl Fn() -> bool) -> Result<(), String> {
    if should_cancel() {
        return Err(SCAN_CANCELLED_MESSAGE.to_owned());
    }
    Ok(())
}

fn directory_error(error: io::Error) -> String {
    // Native errors do not reveal the directory indicated by a journal ID.
    format!("Could not compare an indexed-search directory: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, file_id: u64, kind: IndexedEntryKind) -> DirectoryEntry {
        DirectoryEntry {
            name: name.into(),
            file_id,
            kind,
            size_bytes: (kind == IndexedEntryKind::File).then_some(5),
            can_descend: kind == IndexedEntryKind::Directory,
        }
    }

    #[test]
    fn compares_direct_children_without_refreshing_unrelated_subtrees() {
        use IndexedEntryKind::{Directory, File};
        let existing = [
            ("kept", Directory),
            ("replaced", Directory),
            ("removed", Directory),
            ("Case", File),
            ("resized", File),
            ("same-size", File),
        ]
        .map(|(name, kind)| {
            (
                name.to_owned(),
                Some(CatalogChild {
                    kind,
                    size_bytes: (name == "same-size").then_some(5),
                }),
            )
        })
        .into_iter()
        .collect();
        let entries = vec![
            entry("kept", 1, Directory),
            entry("replaced", 2, Directory),
            entry("case", 3, File),
            entry("resized", 4, File),
            entry("same-size", 5, File),
        ];
        let changed = ParentChanges {
            directories: HashSet::from([2]),
            ..ParentChanges::default()
        };
        let mut plan = ReconcilePlan::default();
        plan_children(r"C:\", existing, entries, changed, None, &mut plan);
        let paths = plan.paths;
        assert!(!paths.contains_key(r"C:\kept"));
        assert!(paths[r"C:\Case"].is_none());
        assert!(paths[r"C:\removed"].is_none());
        assert_eq!(paths[r"C:\replaced"].as_ref().unwrap().file_id, 2);
        assert_eq!(paths[r"C:\case"].as_ref().unwrap().file_id, 3);
        assert!(!paths.contains_key(r"C:\resized"));
        assert_eq!(
            plan.sizes,
            BTreeMap::from([(r"C:\resized".into(), Some(5))])
        );
    }
}
