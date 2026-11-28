// Transfer execution for copy and move operations.
// The executor walks a manifest built during planning so it never has to
// rediscover reparse-point behavior in the hot copy loop.
mod copy;
mod manifest_roots;
mod move_source;
#[cfg(windows)]
pub(crate) use move_source::{CopiedMoveSources, PinnedMoveSource};
mod paths;
mod progress;
#[cfg(test)]
mod replace_tests;
mod staging;
mod transfer;

use self::copy::execute_copy_manifest_root;
use self::manifest_roots::build_copy_manifest_for_path;
use self::progress::{emit_path_progress, emit_root_completion};
use self::transfer::{
    execute_fast_move_root, execute_transfer_root, FastMoveOutcome, TransferOutcome,
};
use super::common::{build_copy_decision_sets, check_transfer_control};
use super::manifest::{build_manifest_root, requested_roots, validate_destination};
use super::strategy::{classify_transfer_root, TransferRootStrategy};
use super::TRANSFER_CANCELLED_MESSAGE;
use crate::domain::filesystem::{
    CopyOptions, CopyReport, EntryIdentity, MovedTransferEntry, RootOutcome, RootReporter,
    TransferControlCallback, TransferOptions, TransferProgressCallback, TransferReport,
};

use std::path::Path;

// A cancelled root ends the job, including when it is the last item in the batch.
fn record_root_failure(
    failures: &mut Vec<String>,
    path: &str,
    error: String,
    on_root: &mut RootReporter<'_>,
) -> Result<(), String> {
    if error == TRANSFER_CANCELLED_MESSAGE {
        return Err(error);
    }
    on_root(Path::new(path), RootOutcome::Failed);
    failures.push(format!("{path}: {error}"));
    Ok(())
}

#[cfg(test)]
pub(super) fn copy_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<CopyOptions>,
    on_progress: Option<&mut TransferProgressCallback>,
    on_control: Option<&mut TransferControlCallback>,
) -> Result<CopyReport, String> {
    copy_entries_reported(
        &paths,
        destination,
        options,
        on_progress,
        on_control,
        &mut |_, _| {},
    )
}

pub(crate) fn copy_entries_reported(
    paths: &[String],
    destination: String,
    options: Option<CopyOptions>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
    on_root: &mut RootReporter<'_>,
) -> Result<CopyReport, String> {
    let target_path = validate_destination(&destination)?;
    let decisions = build_copy_decision_sets(options.as_ref());

    let mut report = CopyReport {
        copied: 0,
        skipped: 0,
        failures: Vec::new(),
        destination: Default::default(),
    };

    let requested = paths
        .iter()
        .filter_map(|path| {
            let trimmed = path.trim().to_string();
            if trimmed.is_empty() {
                on_root(Path::new(path), RootOutcome::Skipped);
                report.skipped = report.skipped.saturating_add(1);
                None
            } else {
                Some(trimmed)
            }
        })
        .collect::<Vec<_>>();
    let total = requested_roots(&requested);

    for (index, raw_path) in requested.into_iter().enumerate() {
        check_transfer_control(&mut on_control)?;
        let processed = index;
        let completed = index + 1;

        let manifest = match build_copy_manifest_for_path(&raw_path, &target_path, &mut on_control)
        {
            Ok(manifest) => manifest,
            Err(error) => {
                record_root_failure(&mut report.failures, &raw_path, error, on_root)?;
                emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                continue;
            }
        };

        let failures_before = report.failures.len();
        match execute_copy_manifest_root(
            &manifest,
            processed,
            total,
            &mut on_progress,
            &mut on_control,
            &decisions,
            &mut report.failures,
            &mut || on_root(&manifest.source, RootOutcome::Skipped),
        ) {
            Ok(outcome) => {
                if report.failures.len() != failures_before {
                    on_root(&manifest.source, RootOutcome::Failed);
                } else if outcome.copied_root && outcome.skipped == 0 {
                    on_root(
                        &manifest.source,
                        RootOutcome::Copied(
                            super::common::entry_kind_for_transfer_kind(manifest.kind),
                            &manifest.destination,
                        ),
                    );
                }
                if outcome.copied_root {
                    report.copied = report.copied.saturating_add(1);
                    report.destination.record_output(&manifest.destination);
                }
                report.skipped = report.skipped.saturating_add(outcome.skipped);
            }
            Err(error) => record_root_failure(&mut report.failures, &raw_path, error, on_root)?,
        }

        emit_root_completion(raw_path, false, completed, total, &mut on_progress);
    }

    Ok(report)
}

// Transfers entries into a destination folder with optional overwrite.
// Auto mode moves within the same drive and copies across drives.
#[cfg(test)]
pub(crate) fn transfer_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<TransferOptions>,
    on_progress: Option<&mut TransferProgressCallback>,
    on_control: Option<&mut TransferControlCallback>,
) -> Result<TransferReport, String> {
    transfer_entries_reported(
        &paths,
        destination,
        options,
        on_progress,
        on_control,
        &mut |_, _| {},
    )
}

pub(crate) fn transfer_entries_reported(
    paths: &[String],
    destination: String,
    options: Option<TransferOptions>,
    on_progress: Option<&mut TransferProgressCallback>,
    on_control: Option<&mut TransferControlCallback>,
    on_root: &mut RootReporter<'_>,
) -> Result<TransferReport, String> {
    let _protected_folder = options
        .as_ref()
        .and_then(|options| options.protected_folder.as_ref())
        .map(|folder| folder.pin_for_transfer())
        .transpose()?;
    let target_path = validate_destination(&destination)?;
    let mut report = TransferReport::default();

    // A later cancellation must still return the committed paths needed by Undo.
    match transfer_roots(
        paths,
        &target_path,
        options.as_ref(),
        on_progress,
        on_control,
        &mut report,
        on_root,
    ) {
        Err(error) if error == TRANSFER_CANCELLED_MESSAGE => report.cancelled = true,
        result => result?,
    }
    Ok(report)
}

fn transfer_roots(
    paths: &[String],
    target_path: &std::path::Path,
    options: Option<&TransferOptions>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
    report: &mut TransferReport,
    on_root: &mut RootReporter<'_>,
) -> Result<(), String> {
    let requested = paths
        .iter()
        .filter_map(|path| {
            let trimmed = path.trim().to_string();
            if trimmed.is_empty() {
                on_root(Path::new(path), RootOutcome::Skipped);
                report.skipped = report.skipped.saturating_add(1);
                None
            } else {
                Some(trimmed)
            }
        })
        .collect::<Vec<_>>();
    let total = requested_roots(&requested);

    for (index, raw_path) in requested.into_iter().enumerate() {
        check_transfer_control(&mut on_control)?;
        let processed = index;
        let completed = index + 1;

        let expected =
            if let Some(sources) = options.and_then(|value| value.expected_sources.as_ref()) {
                let Some(identity) = sources.get(&raw_path) else {
                    record_root_failure(
                        &mut report.failures,
                        &raw_path,
                        "Undo cannot verify this item's identity.".into(),
                        on_root,
                    )?;
                    emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                    continue;
                };
                Some(identity)
            } else {
                None
            };

        let strategy =
            match classify_transfer_root(&raw_path, target_path, options, &mut on_control) {
                Ok(Some(strategy)) => strategy,
                Ok(None) => {
                    on_root(Path::new(&raw_path), RootOutcome::Skipped);
                    emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                    continue;
                }
                Err(error) => {
                    record_root_failure(&mut report.failures, &raw_path, error, on_root)?;
                    emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                    continue;
                }
            };

        // Grouping uses sibling paths on one volume. Never fall back to merging
        // or copying over a name that appeared while the move was queued.
        let grouped_move = strategy.should_move
            && options.is_some_and(|options| options.protected_folder.is_some());
        if strategy.use_fast_move || grouped_move {
            emit_path_progress(&strategy.source, processed, total, &mut on_progress);
            match execute_fast_move_root(
                &strategy.source,
                &strategy.destination,
                expected,
                &mut on_control,
            ) {
                Ok(FastMoveOutcome::Moved(identity)) => {
                    record_move(report, &strategy, identity);
                    on_root(
                        &strategy.source,
                        RootOutcome::Moved(strategy.kind, &strategy.destination),
                    );
                    emit_root_completion(raw_path, true, completed, total, &mut on_progress);
                    continue;
                }
                Err(error) => {
                    record_root_failure(&mut report.failures, &raw_path, error, on_root)?;
                    emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                    continue;
                }
                Ok(FastMoveOutcome::CrossVolume) if grouped_move => {
                    record_root_failure(
                        &mut report.failures,
                        &raw_path,
                        "The folder has to be on the same volume.".into(),
                        on_root,
                    )?;
                    emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                    continue;
                }
                Ok(FastMoveOutcome::CrossVolume) => {}
            }
        }

        let manifest =
            match build_manifest_root(&strategy.source, &strategy.destination, &mut on_control) {
                Ok(manifest) => manifest,
                Err(error) => {
                    record_root_failure(&mut report.failures, &raw_path, error, on_root)?;
                    emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                    continue;
                }
            };

        let failures_before = report.failures.len();
        let source_removed = match execute_transfer_root(
            &manifest,
            strategy.overwrite,
            strategy.should_move,
            expected,
            processed,
            total,
            &mut on_progress,
            &mut on_control,
            &mut report.failures,
        ) {
            Ok(TransferOutcome::Moved(identity)) => {
                record_move(report, &strategy, identity);
                on_root(
                    &strategy.source,
                    if failures_before != report.failures.len() {
                        RootOutcome::Failed
                    } else {
                        RootOutcome::Moved(strategy.kind, &strategy.destination)
                    },
                );
                true
            }
            Ok(TransferOutcome::Copied) => {
                report.copied = report.copied.saturating_add(1);
                report.destination.record_output(&strategy.destination);
                // A published copy with an unfinished move cleanup is not a successful move.
                let outcome = if strategy.should_move || failures_before != report.failures.len() {
                    RootOutcome::Failed
                } else {
                    RootOutcome::Copied(strategy.kind, &strategy.destination)
                };
                on_root(&strategy.source, outcome);
                false
            }
            Err(error) => {
                record_root_failure(&mut report.failures, &raw_path, error, on_root)?;
                false
            }
        };

        emit_root_completion(raw_path, source_removed, completed, total, &mut on_progress);
    }

    Ok(())
}

fn record_move(
    report: &mut TransferReport,
    strategy: &TransferRootStrategy,
    identity: Option<EntryIdentity>,
) {
    report.moved = report.moved.saturating_add(1);
    report.destination.record_output(&strategy.destination);
    report.moved_entries.push(MovedTransferEntry {
        source_path: strategy.source.to_string_lossy().into_owned(),
        destination_path: strategy.destination.to_string_lossy().into_owned(),
        identity,
    });
}
