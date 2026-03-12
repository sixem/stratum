// Preflight planning for copy operations.
// This currently handles conflict discovery and keeps same-folder duplication special-cased.
use super::common::{destination_kind, is_same_directory_copy, normalize_path_key, EntryKind};
use crate::domain::filesystem::{CopyConflict, CopyConflictKind, CopyPlan};
use std::collections::HashMap;
use std::fs;
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

fn plan_copy_file(
    src: &Path,
    dest: &Path,
    conflicts: &mut Vec<CopyConflict>,
    planned: &mut HashMap<String, EntryKind>,
) -> Result<(), String> {
    match destination_kind(dest, planned)? {
        None => {
            planned.insert(normalize_path_key(dest), EntryKind::File);
        }
        Some(EntryKind::File) => {
            push_copy_conflict(conflicts, src, dest, CopyConflictKind::FileToFile);
        }
        Some(EntryKind::Directory) => {
            push_copy_conflict(conflicts, src, dest, CopyConflictKind::FileToDirectory);
        }
    }
    Ok(())
}

fn plan_copy_dir(
    src: &Path,
    dest: &Path,
    conflicts: &mut Vec<CopyConflict>,
    planned: &mut HashMap<String, EntryKind>,
) -> Result<(), String> {
    match destination_kind(dest, planned)? {
        Some(EntryKind::File) => {
            push_copy_conflict(conflicts, src, dest, CopyConflictKind::DirectoryToFile);
            return Ok(());
        }
        Some(EntryKind::Directory) | None => {
            planned.insert(normalize_path_key(dest), EntryKind::Directory);
        }
    }

    for entry in fs::read_dir(src).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_dir() {
            plan_copy_dir(&src_path, &dest_path, conflicts, planned)?;
        } else {
            plan_copy_file(&src_path, &dest_path, conflicts, planned)?;
        }
    }

    Ok(())
}

fn plan_copy_path(
    src: &Path,
    dest: &Path,
    conflicts: &mut Vec<CopyConflict>,
    planned: &mut HashMap<String, EntryKind>,
) -> Result<(), String> {
    let metadata = fs::metadata(src).map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        return plan_copy_dir(src, dest, conflicts, planned);
    }
    plan_copy_file(src, dest, conflicts, planned)
}

pub fn plan_copy_entries(paths: Vec<String>, destination: String) -> Result<CopyPlan, String> {
    let target = destination.trim();
    if target.is_empty() {
        return Err("Empty destination".to_string());
    }
    let target_path = PathBuf::from(target);
    if !target_path.exists() {
        return Err("Destination does not exist".to_string());
    }
    if !target_path.is_dir() {
        return Err("Destination is not a folder".to_string());
    }

    let mut conflicts = Vec::new();
    let mut planned = HashMap::new();

    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }

        let src = PathBuf::from(trimmed);
        let metadata = fs::metadata(&src).map_err(|err| err.to_string())?;
        if metadata.is_dir() && target_path.starts_with(&src) {
            return Err("Destination is inside source".to_string());
        }

        let name = src
            .file_name()
            .ok_or_else(|| "Unable to resolve source name".to_string())?;
        if is_same_directory_copy(&src, &target_path) {
            continue;
        }

        let dest_path = target_path.join(name);
        plan_copy_path(&src, &dest_path, &mut conflicts, &mut planned)?;
    }

    Ok(CopyPlan { conflicts })
}
