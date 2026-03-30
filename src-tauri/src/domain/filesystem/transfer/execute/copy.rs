// Copy-specific manifest execution.
// This module owns overwrite handling and per-entry copy work so the public
// entrypoint can stay focused on report assembly.
use super::paths::{
    create_manifest_directory, ensure_parent_directory, existing_entry_kind,
    remove_existing_destination_root,
};
use super::progress::{emit_file_bytes, emit_file_start};
use super::super::common::{
    check_transfer_control, path_exists, path_is_same_or_within,
    should_overwrite_copy_destination, should_skip_copy_destination, CopyDecisionSets,
    CopyExecution, TransferEntryKind,
};
use super::super::manifest::{TransferManifestEntry, TransferManifestRoot};
use crate::domain::filesystem::{TransferControlCallback, TransferProgressCallback};
#[cfg(not(target_os = "windows"))]
use std::fs;
#[cfg(not(target_os = "windows"))]
use std::io::{Read, Write};
use std::path::PathBuf;

#[cfg(target_os = "windows")]
use super::super::native_windows::copy_file_entry_native;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ManifestEntryOutcome {
    Copied,
    Skipped,
}

#[cfg(not(target_os = "windows"))]
fn copy_file_entry_fallback(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    ensure_parent_directory(&entry.destination)?;
    let mut reader = fs::File::open(&entry.source).map_err(|err| err.to_string())?;
    let mut writer = fs::File::create(&entry.destination).map_err(|err| err.to_string())?;
    let mut copied = 0u64;
    let mut buffer = vec![0u8; super::super::common::COPY_CHUNK_SIZE];

    loop {
        check_transfer_control(on_control)?;
        let bytes = reader.read(&mut buffer).map_err(|err| err.to_string())?;
        if bytes == 0 {
            break;
        }
        writer
            .write_all(&buffer[..bytes])
            .map_err(|err| err.to_string())?;
        copied = copied.saturating_add(bytes as u64);
        emit_file_bytes(processed, total, copied, entry.bytes_total, on_progress);
    }

    if let Ok(metadata) = fs::metadata(&entry.source) {
        let _ = fs::set_permissions(&entry.destination, metadata.permissions());
    }

    Ok(())
}

pub(super) fn copy_manifest_file_entry(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    check_transfer_control(on_control)?;
    emit_file_start(entry, processed, total, on_progress);

    let copy_result = {
        #[cfg(target_os = "windows")]
        {
            ensure_parent_directory(&entry.destination)?;
            copy_file_entry_native(
                &entry.source,
                &entry.destination,
                entry.kind,
                processed,
                total,
                entry.bytes_total,
                on_progress,
                on_control,
            )
        }

        #[cfg(not(target_os = "windows"))]
        {
            copy_file_entry_fallback(entry, processed, total, on_progress, on_control)
        }
    };

    if let Err(error) = copy_result {
        if path_exists(&entry.destination) {
            let _ = super::super::common::remove_path_by_kind(&entry.destination, entry.kind);
        }
        return Err(error);
    }

    emit_file_bytes(
        processed,
        total,
        entry.bytes_total,
        entry.bytes_total,
        on_progress,
    );
    Ok(())
}

fn execute_copy_manifest_entry_with_decisions(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
    decisions: &CopyDecisionSets,
) -> Result<ManifestEntryOutcome, String> {
    check_transfer_control(on_control)?;

    match entry.kind {
        TransferEntryKind::Directory => match existing_entry_kind(&entry.destination)? {
            Some(TransferEntryKind::Directory) => Ok(ManifestEntryOutcome::Copied),
            Some(_) => {
                if should_skip_copy_destination(&entry.destination, decisions) {
                    Ok(ManifestEntryOutcome::Skipped)
                } else if should_overwrite_copy_destination(&entry.destination, decisions) {
                    remove_existing_destination_root(&entry.destination, on_control)?;
                    create_manifest_directory(entry, processed, total, on_progress)?;
                    Ok(ManifestEntryOutcome::Copied)
                } else {
                    Err("destination already exists".to_string())
                }
            }
            None => {
                create_manifest_directory(entry, processed, total, on_progress)?;
                Ok(ManifestEntryOutcome::Copied)
            }
        },
        _ => {
            if existing_entry_kind(&entry.destination)?.is_some() {
                if should_skip_copy_destination(&entry.destination, decisions) {
                    return Ok(ManifestEntryOutcome::Skipped);
                }
                if should_overwrite_copy_destination(&entry.destination, decisions) {
                    remove_existing_destination_root(&entry.destination, on_control)?;
                } else {
                    return Err("destination already exists".to_string());
                }
            }

            copy_manifest_file_entry(entry, processed, total, on_progress, on_control)?;
            Ok(ManifestEntryOutcome::Copied)
        }
    }
}

pub(super) fn execute_copy_manifest_root(
    root: &TransferManifestRoot,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
    decisions: &CopyDecisionSets,
) -> Result<CopyExecution, String> {
    let mut skipped = 0usize;
    let mut skipped_prefixes = Vec::<PathBuf>::new();
    let mut copied_root = true;

    for entry in &root.entries {
        if skipped_prefixes
            .iter()
            .any(|prefix| path_is_same_or_within(&entry.source, prefix))
        {
            continue;
        }

        match execute_copy_manifest_entry_with_decisions(
            entry,
            processed,
            total,
            on_progress,
            on_control,
            decisions,
        )? {
            ManifestEntryOutcome::Copied => {}
            ManifestEntryOutcome::Skipped => {
                skipped = skipped.saturating_add(1);
                if entry.kind.is_traversable_directory() {
                    skipped_prefixes.push(entry.source.clone());
                }
                if entry.source == root.source {
                    copied_root = false;
                }
            }
        }
    }

    Ok(CopyExecution {
        copied_root,
        skipped,
    })
}
