// Transfer execution for copy and move operations.
// The executor walks a manifest built during planning so it never has to
// rediscover reparse-point behavior in the hot copy loop.
mod copy;
mod manifest_roots;
mod paths;
mod progress;
mod transfer;

use self::copy::execute_copy_manifest_root;
use self::manifest_roots::{build_copy_manifest_for_path, build_transfer_manifest_for_path};
use self::progress::emit_root_completion;
use self::transfer::execute_transfer_root;
use super::common::{build_copy_decision_sets, check_transfer_control, same_drive};
use super::manifest::{requested_roots, validate_destination};
use crate::domain::filesystem::{
    CopyOptions, CopyReport, TransferControlCallback, TransferMode, TransferOptions,
    TransferProgressCallback, TransferReport,
};

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
                report.failures.push(format!("{}: {}", raw_path, error));
                emit_root_completion(&mut on_progress, completed, total);
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
        ) {
            Ok(outcome) => {
                if outcome.copied_root {
                    report.copied = report.copied.saturating_add(1);
                }
                report.skipped = report.skipped.saturating_add(outcome.skipped);
            }
            Err(error) => report.failures.push(format!("{}: {}", raw_path, error)),
        }

        emit_root_completion(&mut on_progress, completed, total);
    }

    Ok(report)
}

// Transfers entries into a destination folder with optional overwrite.
// Auto mode moves within the same drive and copies across drives.
pub fn transfer_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<TransferOptions>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<TransferReport, String> {
    let target_path = validate_destination(&destination)?;
    let mode = options
        .as_ref()
        .and_then(|value| value.mode)
        .unwrap_or(TransferMode::Auto);
    let overwrite = options
        .as_ref()
        .and_then(|value| value.overwrite)
        .unwrap_or(false);

    let mut report = TransferReport {
        copied: 0,
        moved: 0,
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

        let manifest =
            match build_transfer_manifest_for_path(&raw_path, &target_path, &mut on_control) {
                Ok(manifest) => manifest,
                Err(error) => {
                    report.failures.push(format!("{}: {}", raw_path, error));
                    emit_root_completion(&mut on_progress, completed, total);
                    continue;
                }
            };

        let should_move = match mode {
            TransferMode::Copy => false,
            TransferMode::Move => true,
            TransferMode::Auto => same_drive(&manifest.source, &target_path),
        };

        match execute_transfer_root(
            &manifest,
            overwrite,
            should_move,
            processed,
            total,
            &mut on_progress,
            &mut on_control,
        ) {
            Ok(true) => report.moved = report.moved.saturating_add(1),
            Ok(false) => report.copied = report.copied.saturating_add(1),
            Err(error) => report.failures.push(format!("{}: {}", raw_path, error)),
        }

        emit_root_completion(&mut on_progress, completed, total);
    }

    Ok(report)
}
