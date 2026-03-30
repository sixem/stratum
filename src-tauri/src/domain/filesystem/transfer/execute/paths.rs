// Shared path and cleanup helpers for manifest execution.
// Copy and move flows both need these operations, so we keep them in one
// place instead of threading small filesystem details through multiple files.
use super::progress::emit_directory_progress;
use super::super::common::{
    inspect_path, path_exists, remove_path_by_kind, TransferEntryKind,
};
use super::super::manifest::{build_manifest_root, TransferManifestEntry, TransferManifestRoot};
use crate::domain::filesystem::{TransferControlCallback, TransferProgressCallback};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

pub(super) fn existing_entry_kind(path: &Path) -> Result<Option<TransferEntryKind>, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => inspect_path(path).map(|inspection| Some(inspection.kind)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub(super) fn ensure_parent_directory(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub(super) fn create_manifest_directory(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) -> Result<(), String> {
    emit_directory_progress(entry, processed, total, on_progress);
    fs::create_dir_all(&entry.destination).map_err(|err| err.to_string())
}

pub(super) fn remove_manifest_source(root: &TransferManifestRoot) -> Result<(), String> {
    for entry in root.entries.iter().rev() {
        if !path_exists(&entry.source) {
            continue;
        }
        remove_path_by_kind(&entry.source, entry.kind)?;
    }
    Ok(())
}

pub(super) fn remove_existing_destination_root(
    destination: &Path,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    let Some(kind) = existing_entry_kind(destination)? else {
        return Ok(());
    };

    if kind == TransferEntryKind::Directory {
        let manifest = build_manifest_root(destination, destination, on_control)?;
        return remove_manifest_source(&manifest);
    }

    remove_path_by_kind(destination, kind)
}
