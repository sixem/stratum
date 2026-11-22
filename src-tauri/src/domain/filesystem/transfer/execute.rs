// Transfer execution for copy and move operations.
// The executor walks a manifest built during planning so it never has to
// rediscover reparse-point behavior in the hot copy loop.
mod copy;
mod manifest_roots;
mod move_source;
mod paths;
mod progress;
#[cfg(test)]
mod replace_tests;
mod staging;
mod transfer;

use self::copy::execute_copy_manifest_root;
use self::manifest_roots::build_copy_manifest_for_path;
use self::progress::{emit_path_progress, emit_root_completion};
use self::transfer::{execute_fast_move_root, execute_transfer_root};
use super::common::{build_copy_decision_sets, check_transfer_control};
use super::manifest::{build_manifest_root, requested_roots, validate_destination};
use super::strategy::classify_transfer_root;
use super::TRANSFER_CANCELLED_MESSAGE;
use crate::domain::filesystem::{
    CopyOptions, CopyReport, MovedTransferEntry, TransferControlCallback, TransferOptions,
    TransferProgressCallback, TransferReport,
};

// A cancelled root ends the job, including when it is the last item in the batch.
fn record_root_failure(
    failures: &mut Vec<String>,
    path: &str,
    error: String,
) -> Result<(), String> {
    if error == TRANSFER_CANCELLED_MESSAGE {
        return Err(error);
    }
    failures.push(format!("{path}: {error}"));
    Ok(())
}

pub fn copy_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<CopyOptions>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<CopyReport, String> {
    let target_path = validate_destination(&destination)?;
    let decisions = build_copy_decision_sets(options.as_ref());

    let mut report = CopyReport {
        copied: 0,
        skipped: 0,
        failures: Vec::new(),
    };

    let requested = paths
        .into_iter()
        .filter_map(|path| {
            let trimmed = path.trim().to_string();
            if trimmed.is_empty() {
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
                record_root_failure(&mut report.failures, &raw_path, error)?;
                emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                continue;
            }
        };

        match execute_copy_manifest_root(
            &manifest,
            processed,
            total,
            &mut on_progress,
            &mut on_control,
            &decisions,
            &mut report.failures,
        ) {
            Ok(outcome) => {
                if outcome.copied_root {
                    report.copied = report.copied.saturating_add(1);
                }
                report.skipped = report.skipped.saturating_add(outcome.skipped);
            }
            Err(error) => record_root_failure(&mut report.failures, &raw_path, error)?,
        }

        emit_root_completion(raw_path, false, completed, total, &mut on_progress);
    }

    Ok(report)
}

// Transfers entries into a destination folder with optional overwrite.
// Auto mode moves within the same drive and copies across drives.
pub fn transfer_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<TransferOptions>,
    on_progress: Option<&mut TransferProgressCallback>,
    on_control: Option<&mut TransferControlCallback>,
) -> Result<TransferReport, String> {
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
    ) {
        Err(error) if error == TRANSFER_CANCELLED_MESSAGE => report.cancelled = true,
        result => result?,
    }
    Ok(report)
}

fn transfer_roots(
    paths: Vec<String>,
    target_path: &std::path::Path,
    options: Option<&TransferOptions>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
    report: &mut TransferReport,
) -> Result<(), String> {
    let requested = paths
        .into_iter()
        .filter_map(|path| {
            let trimmed = path.trim().to_string();
            if trimmed.is_empty() {
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

        let strategy =
            match classify_transfer_root(&raw_path, target_path, options, &mut on_control) {
                Ok(Some(strategy)) => strategy,
                Ok(None) => {
                    emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                    continue;
                }
                Err(error) => {
                    record_root_failure(&mut report.failures, &raw_path, error)?;
                    emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                    continue;
                }
            };

        if strategy.use_fast_move {
            emit_path_progress(&strategy.source, processed, total, &mut on_progress);
            match execute_fast_move_root(&strategy.source, &strategy.destination, &mut on_control) {
                Ok(true) => {
                    report.moved = report.moved.saturating_add(1);
                    report.moved_entries.push(MovedTransferEntry {
                        source_path: strategy.source.to_string_lossy().to_string(),
                        destination_path: strategy.destination.to_string_lossy().to_string(),
                    });
                    emit_root_completion(raw_path, true, completed, total, &mut on_progress);
                    continue;
                }
                Err(error) => {
                    record_root_failure(&mut report.failures, &raw_path, error)?;
                    emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                    continue;
                }
                Ok(false) => {}
            }
        }

        let manifest =
            match build_manifest_root(&strategy.source, &strategy.destination, &mut on_control) {
                Ok(manifest) => manifest,
                Err(error) => {
                    record_root_failure(&mut report.failures, &raw_path, error)?;
                    emit_root_completion(raw_path, false, completed, total, &mut on_progress);
                    continue;
                }
            };

        let source_removed = match execute_transfer_root(
            &manifest,
            strategy.overwrite,
            strategy.should_move,
            processed,
            total,
            &mut on_progress,
            &mut on_control,
            &mut report.failures,
        ) {
            Ok(true) => {
                report.moved = report.moved.saturating_add(1);
                report.moved_entries.push(MovedTransferEntry {
                    source_path: strategy.source.to_string_lossy().to_string(),
                    destination_path: strategy.destination.to_string_lossy().to_string(),
                });
                true
            }
            Ok(false) => {
                report.copied = report.copied.saturating_add(1);
                false
            }
            Err(error) => {
                record_root_failure(&mut report.failures, &raw_path, error)?;
                false
            }
        };

        emit_root_completion(raw_path, source_removed, completed, total, &mut on_progress);
    }

    Ok(())
}
