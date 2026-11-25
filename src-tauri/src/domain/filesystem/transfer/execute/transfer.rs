// Move and cross-drive transfer execution.
// This layer coordinates overwrite handling and move-vs-copy policy once the
// manifest has already been built.
use super::super::common::{check_transfer_control, same_drive};
use super::super::manifest::TransferManifestRoot;
use super::move_source::{pin_expected_source, remove_manifest_source, SourceSnapshot};
use super::paths::existing_entry_kind;
use super::progress::emit_manifest_move_completion;
use super::staging::TransferStage;
use crate::domain::filesystem::file_identity::{rename_verified, ObservedEntry};
use crate::domain::filesystem::staging::rename_new;
use crate::domain::filesystem::{EntryIdentity, TransferControlCallback, TransferProgressCallback};
use std::io::ErrorKind;
use std::path::Path;

pub(super) enum TransferOutcome {
    Moved(Option<EntryIdentity>),
    Copied,
}

pub(super) enum FastMoveOutcome {
    Moved(Option<EntryIdentity>),
    CrossVolume,
}

pub(super) fn execute_fast_move_root(
    source: &Path,
    destination: &Path,
    expected: Option<&EntryIdentity>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<FastMoveOutcome, String> {
    check_transfer_control(on_control)?;

    let original = if expected.is_none() {
        ObservedEntry::capture(source)
    } else {
        None
    };
    let result = if let Some(expected) = expected {
        rename_verified(source, destination, expected)
    } else {
        rename_new(source, destination)
    };
    match result {
        Ok(()) => Ok(FastMoveOutcome::Moved(
            original.and_then(|entry| entry.published(destination)),
        )),
        // A mount point can put two paths on different volumes under one drive letter.
        Err(error) if error.kind() == ErrorKind::CrossesDevices => Ok(FastMoveOutcome::CrossVolume),
        Err(error) => Err(error.to_string()),
    }
}

fn execute_transfer_manifest_root(
    root: &TransferManifestRoot,
    staged_root: &Path,
    should_move: bool,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<Vec<SourceSnapshot>, String> {
    let mut snapshots = Vec::new();
    for entry in &root.entries {
        check_transfer_control(on_control)?;
        let mut copy = || {
            super::copy::copy_staged_entry(
                entry,
                &root.destination,
                staged_root,
                processed,
                total,
                on_progress,
                on_control,
            )
        };
        if should_move {
            snapshots.push(SourceSnapshot::copy(entry, copy)?);
        } else {
            copy()?;
        }
    }
    Ok(snapshots)
}

pub(super) fn execute_transfer_root(
    root: &TransferManifestRoot,
    overwrite: bool,
    should_move: bool,
    expected: Option<&EntryIdentity>,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
    cleanup_failures: &mut Vec<String>,
) -> Result<TransferOutcome, String> {
    check_transfer_control(on_control)?;

    if expected.is_some() && (!should_move || overwrite) {
        return Err("Undo requires moving without replacing the destination.".into());
    }
    let existing = existing_entry_kind(&root.destination)?;
    if existing.is_some() && !overwrite {
        return Err("destination already exists".to_string());
    }

    let mut stage = TransferStage::new(&root.destination)?;
    if expected.is_none() && should_move && same_drive(&root.source, &root.destination) {
        check_transfer_control(on_control)?;
        let original = ObservedEntry::capture(&root.source);
        match stage.publish(
            &root.source,
            &root.destination,
            root.kind,
            existing,
            cleanup_failures,
        ) {
            Ok(()) => {
                emit_manifest_move_completion(root, processed, total, on_progress);
                return Ok(TransferOutcome::Moved(
                    original.and_then(|entry| entry.published(&root.destination)),
                ));
            }
            Err(error) if error.kind() == ErrorKind::CrossesDevices => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    let verified_root = expected
        .map(|expected| pin_expected_source(&root.source, expected))
        .transpose()
        .map_err(|error| error.to_string())?;
    let incoming = stage.payload()?;
    let snapshots = execute_transfer_manifest_root(
        root,
        &incoming,
        should_move,
        processed,
        total,
        on_progress,
        on_control,
    )?;
    check_transfer_control(on_control)?;
    let staged_entry = if should_move && expected.is_none() {
        ObservedEntry::capture(&incoming)
    } else {
        None
    };
    stage
        .publish(
            &incoming,
            &root.destination,
            root.kind,
            existing,
            cleanup_failures,
        )
        .map_err(|err| err.to_string())?;
    let published = staged_entry.and_then(|entry| entry.published(&root.destination));
    drop(verified_root);
    if should_move {
        if let Err(warning) = remove_manifest_source(root, &snapshots) {
            cleanup_failures.push(warning);
            return Ok(TransferOutcome::Copied);
        }
        return Ok(TransferOutcome::Moved(published));
    }
    Ok(TransferOutcome::Copied)
}
