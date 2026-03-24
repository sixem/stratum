// Preflight planning for copy operations.
// The planner walks the same manifest shape that execution uses so conflict
// detection stays aligned with Windows reparse-point handling.
use super::common::{
    destination_kind, entry_kind_for_transfer_kind, normalize_path_key, path_is_same_or_within,
    EntryKind,
};
use super::manifest::{build_copy_destination, build_manifest_root, validate_destination};
use crate::domain::filesystem::{CopyConflict, CopyConflictKind, CopyPlan};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

fn push_copy_conflict(
    conflicts: &mut Vec<CopyConflict>,
    src: &Path,
    dest: &Path,
    kind: CopyConflictKind,
) {
    conflicts.push(CopyConflict {
        source_path: src.to_string_lossy().to_string(),
        destination_path: dest.to_string_lossy().to_string(),
        kind,
    });
}

fn plan_manifest_entry(
    src: &Path,
    dest: &Path,
    source_kind: EntryKind,
    conflicts: &mut Vec<CopyConflict>,
    planned: &mut HashMap<String, EntryKind>,
) -> Result<(), String> {
    match source_kind {
        EntryKind::File => match destination_kind(dest, planned)? {
            None => {
                planned.insert(normalize_path_key(dest), EntryKind::File);
            }
            Some(EntryKind::File) => {
                push_copy_conflict(conflicts, src, dest, CopyConflictKind::FileToFile);
            }
            Some(EntryKind::Directory) => {
                push_copy_conflict(conflicts, src, dest, CopyConflictKind::FileToDirectory);
            }
        },
        EntryKind::Directory => match destination_kind(dest, planned)? {
            Some(EntryKind::File) => {
                push_copy_conflict(conflicts, src, dest, CopyConflictKind::DirectoryToFile);
            }
            Some(EntryKind::Directory) | None => {
                planned.insert(normalize_path_key(dest), EntryKind::Directory);
            }
        },
    }

    Ok(())
}

pub fn plan_copy_entries(paths: Vec<String>, destination: String) -> Result<CopyPlan, String> {
    let target_path = validate_destination(&destination)?;
    let mut conflicts = Vec::new();
    let mut planned = HashMap::new();

    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }

        let source = PathBuf::from(trimmed);
        let destination = build_copy_destination(&source, &target_path)
            .ok_or_else(|| "Unable to resolve source name".to_string())?;
        let manifest = build_manifest_root(&source, &destination, &mut None)?;
        if manifest.kind.is_traversable_directory()
            && path_is_same_or_within(&manifest.destination, &manifest.source)
        {
            return Err("Destination is inside source".to_string());
        }

        for entry in manifest.entries {
            let source_kind = entry_kind_for_transfer_kind(entry.kind);
            plan_manifest_entry(
                &entry.source,
                &entry.destination,
                source_kind,
                &mut conflicts,
                &mut planned,
            )?;
        }
    }

    Ok(CopyPlan { conflicts })
}
