// Move and cross-drive transfer execution.
// This layer coordinates overwrite handling and move-vs-copy policy once the
// manifest has already been built.
use super::copy::copy_manifest_file_entry;
use super::paths::{
    create_manifest_directory, ensure_parent_directory, existing_entry_kind,
    remove_existing_destination_root, remove_manifest_source,
};
use super::super::common::{check_transfer_control, same_drive, TransferEntryKind};
use super::super::manifest::TransferManifestRoot;
use crate::domain::filesystem::{TransferControlCallback, TransferProgressCallback};
use std::fs;

fn execute_transfer_manifest_root(
    root: &TransferManifestRoot,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    for entry in &root.entries {
        check_transfer_control(on_control)?;
        match entry.kind {
            TransferEntryKind::Directory => {
                create_manifest_directory(entry, processed, total, on_progress)?;
            }
            _ => {
                copy_manifest_file_entry(entry, processed, total, on_progress, on_control)?;
            }
        }
    }
    Ok(())
}

pub(super) fn execute_transfer_root(
    root: &TransferManifestRoot,
    overwrite: bool,
    should_move: bool,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<bool, String> {
    check_transfer_control(on_control)?;

    if existing_entry_kind(&root.destination)?.is_some() {
        if !overwrite {
            return Err("destination already exists".to_string());
        }
        remove_existing_destination_root(&root.destination, on_control)?;
    }

    if should_move && same_drive(&root.source, &root.destination) {
        ensure_parent_directory(&root.destination)?;
        if fs::rename(&root.source, &root.destination).is_ok() {
            return Ok(true);
        }
    }

    execute_transfer_manifest_root(root, processed, total, on_progress, on_control)?;
    if should_move {
        check_transfer_control(on_control)?;
        remove_manifest_source(root)?;
        return Ok(true);
    }

    Ok(false)
}
