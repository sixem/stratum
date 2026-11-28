// Merge copy manifests one conflict at a time. Each new file or subtree is
// complete before its final destination name is published.
use super::super::common::{
    check_transfer_control, path_is_same_or_within, should_overwrite_copy_destination,
    should_skip_copy_destination, CopyDecisionSets, CopyExecution, TransferEntryKind,
};
use super::super::manifest::{TransferManifestEntry, TransferManifestRoot};
use super::paths::existing_entry_kind;
use super::progress::{emit_file_bytes, emit_file_start, emit_path_progress};
use super::staging::TransferStage;
use crate::domain::filesystem::{
    CompletedFileWork, TransferControlCallback, TransferProgressCallback,
};
use std::fs;
use std::path::Path;

#[cfg(not(target_os = "windows"))]
fn copy_file_entry_fallback(
    entry: &TransferManifestEntry,
    destination: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    use std::io::{Read, Write};

    let mut reader = fs::File::open(&entry.source).map_err(|err| err.to_string())?;
    let mut writer = fs::File::create_new(destination).map_err(|err| err.to_string())?;
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
        emit_file_bytes(
            processed,
            total,
            copied,
            entry.bytes_total,
            None,
            on_progress,
        );
    }
    if let Ok(metadata) = reader.metadata() {
        let _ = fs::set_permissions(destination, metadata.permissions());
    }
    Ok(())
}

pub(super) fn copy_staged_entry(
    entry: &TransferManifestEntry,
    destination_root: &Path,
    staged_root: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    check_transfer_control(on_control)?;
    let relative = entry
        .destination
        .strip_prefix(destination_root)
        .map_err(|err| err.to_string())?;
    // Joining an empty path can add a trailing separator to a file name.
    let destination = if relative.as_os_str().is_empty() {
        staged_root.to_owned()
    } else {
        staged_root.join(relative)
    };
    if entry.kind == TransferEntryKind::Directory {
        emit_path_progress(&entry.source, processed, total, on_progress);
        return fs::create_dir(destination).map_err(|err| err.to_string());
    }

    emit_file_start(entry, processed, total, on_progress);
    #[cfg(target_os = "windows")]
    super::super::native_windows::copy_file_entry_native(
        &entry.source,
        &destination,
        entry.kind,
        processed,
        total,
        entry.bytes_total,
        on_progress,
        on_control,
    )?;
    #[cfg(not(target_os = "windows"))]
    copy_file_entry_fallback(
        entry,
        &destination,
        processed,
        total,
        on_progress,
        on_control,
    )?;
    emit_file_bytes(
        processed,
        total,
        entry.bytes_total,
        entry.bytes_total,
        Some(CompletedFileWork {
            files: 1,
            bytes: entry.bytes_total,
        }),
        on_progress,
    );
    Ok(())
}

pub(super) fn execute_copy_manifest_root(
    root: &TransferManifestRoot,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
    decisions: &CopyDecisionSets,
    cleanup_failures: &mut Vec<String>,
    on_skip: &mut dyn FnMut(),
) -> Result<CopyExecution, String> {
    let mut outcome = CopyExecution {
        copied_root: true,
        skipped: 0,
    };
    let mut remaining = root.entries.as_slice();
    while let Some((entry, rest)) = remaining.split_first() {
        check_transfer_control(on_control)?;
        let existing = existing_entry_kind(&entry.destination)?;
        if entry.kind == TransferEntryKind::Directory
            && existing == Some(TransferEntryKind::Directory)
        {
            remaining = rest;
            continue;
        }
        // The manifest is in depth-first order. A directory replacing a file
        // owns this entire run, including every child whose copy could fail.
        let descendants = if entry.kind == TransferEntryKind::Directory {
            rest.iter()
                .take_while(|child| child.source.starts_with(&entry.source))
                .count()
        } else {
            0
        };
        let (subtree, next) = remaining.split_at(descendants + 1);
        remaining = next;
        if existing.is_some() {
            if should_skip_copy_destination(&entry.destination, decisions) {
                on_skip();
                outcome.skipped += 1;
                if entry.source == root.source {
                    outcome.copied_root = false;
                }
                continue;
            }
            if !should_overwrite_copy_destination(&entry.destination, decisions) {
                return Err("destination already exists".to_string());
            }
            if existing == Some(TransferEntryKind::Directory)
                && (path_is_same_or_within(&root.source, &entry.destination)
                    || path_is_same_or_within(&entry.destination, &root.source))
            {
                return Err("destination contains the source".to_string());
            }
        }

        let mut stage = TransferStage::new(&entry.destination)?;
        let incoming = stage.payload()?;
        for child in subtree {
            copy_staged_entry(
                child,
                &entry.destination,
                &incoming,
                processed,
                total,
                on_progress,
                on_control,
            )?;
        }
        check_transfer_control(on_control)?;
        stage
            .publish(
                &incoming,
                &entry.destination,
                entry.kind,
                existing,
                cleanup_failures,
            )
            .map_err(|err| err.to_string())?;
    }
    Ok(outcome)
}
