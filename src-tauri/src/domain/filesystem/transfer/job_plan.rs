// Backend planning for managed transfer jobs.
// The queue uses these manifests to compute stable work estimates before
// execution starts, without following Windows reparse points by accident.
use super::common::{check_transfer_control, same_drive};
use super::manifest::{
    build_copy_destination, build_manifest_root, build_transfer_destination, requested_roots,
    validate_destination,
};
use super::types::TransferWorkEstimate;
use crate::domain::filesystem::{
    CopyOptions, TransferControlCallback, TransferMode, TransferOptions,
};
use std::path::PathBuf;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TransferProgressKind {
    Roots,
    Files,
}

#[derive(Clone)]
pub(crate) struct PlannedTransferJob {
    pub work: TransferWorkEstimate,
    pub progress_kind: TransferProgressKind,
}

pub(crate) fn plan_root_only_job(paths: &[String]) -> PlannedTransferJob {
    PlannedTransferJob {
        work: TransferWorkEstimate {
            roots_total: requested_roots(paths),
            roots_completed: 0,
            files_total: None,
            files_completed: 0,
            bytes_total: None,
            bytes_completed: 0,
        },
        progress_kind: TransferProgressKind::Roots,
    }
}

pub(crate) fn plan_copy_job(
    paths: &[String],
    destination: &str,
    _options: Option<&CopyOptions>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<PlannedTransferJob, String> {
    let target_path = validate_destination(destination)?;
    let roots_total = requested_roots(paths);
    let mut files_total = 0usize;
    let mut bytes_total = 0u64;

    for raw_path in paths {
        check_transfer_control(&mut on_control)?;
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            continue;
        }

        let source = PathBuf::from(trimmed);
        let destination = match build_copy_destination(&source, &target_path) {
            Some(destination) => destination,
            None => continue,
        };
        let manifest = build_manifest_root(&source, &destination, &mut on_control)?;
        files_total = files_total.saturating_add(manifest.file_count);
        bytes_total = bytes_total.saturating_add(manifest.byte_count);
    }

    Ok(PlannedTransferJob {
        work: TransferWorkEstimate {
            roots_total,
            roots_completed: 0,
            files_total: Some(files_total),
            files_completed: 0,
            bytes_total: Some(bytes_total),
            bytes_completed: 0,
        },
        progress_kind: TransferProgressKind::Files,
    })
}

pub(crate) fn plan_transfer_job(
    paths: &[String],
    destination: &str,
    options: Option<&TransferOptions>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<PlannedTransferJob, String> {
    let target_path = validate_destination(destination)?;
    let roots_total = requested_roots(paths);
    let requested_mode = options
        .and_then(|value| value.mode)
        .unwrap_or(TransferMode::Auto);
    let mut files_total = 0usize;
    let mut bytes_total = 0u64;
    let mut progress_kind = TransferProgressKind::Files;

    for raw_path in paths {
        check_transfer_control(&mut on_control)?;
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            continue;
        }

        let source = PathBuf::from(trimmed);
        let destination = match build_transfer_destination(&source, &target_path) {
            Some(destination) => destination,
            None => continue,
        };
        let manifest = build_manifest_root(&source, &destination, &mut on_control)?;

        let should_move = match requested_mode {
            TransferMode::Copy => false,
            TransferMode::Move => true,
            TransferMode::Auto => same_drive(&source, &target_path),
        };
        if should_move && same_drive(&source, &target_path) {
            progress_kind = TransferProgressKind::Roots;
        }

        files_total = files_total.saturating_add(manifest.file_count);
        bytes_total = bytes_total.saturating_add(manifest.byte_count);
    }

    let (files_total, bytes_total) = match progress_kind {
        TransferProgressKind::Roots => (None, None),
        TransferProgressKind::Files => (Some(files_total), Some(bytes_total)),
    };

    Ok(PlannedTransferJob {
        work: TransferWorkEstimate {
            roots_total,
            roots_completed: 0,
            files_total,
            files_completed: 0,
            bytes_total,
            bytes_completed: 0,
        },
        progress_kind,
    })
}
