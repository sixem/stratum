// Backend planning for managed transfer jobs.
// The queue scans manifests for stable work estimates before
// execution starts, without following Windows reparse points by accident.
use super::common::check_transfer_control;
use super::delete_discovery::{
    discover_delete_plan, DeleteDiscoveryPlan, DeleteDiscoveryProgressCallback,
};
use super::manifest::{estimate_manifest_work, requested_roots, validate_destination};
use super::strategy::classify_transfer_root;
use super::types::TransferWorkEstimate;
use crate::domain::filesystem::{CopyOptions, TransferControlCallback, TransferOptions};
use std::path::Path;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TransferProgressKind {
    Roots,
    Files,
    Items,
}

pub(crate) struct PlannedTransferJob {
    pub work: TransferWorkEstimate,
    pub progress_kind: TransferProgressKind,
    pub delete_discovery: Option<DeleteDiscoveryPlan>,
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
        delete_discovery: None,
    }
}

pub(crate) fn plan_copy_job(
    paths: &[String],
    destination: &str,
    _options: Option<&CopyOptions>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<PlannedTransferJob, String> {
    validate_destination(destination)?;
    let roots_total = requested_roots(paths);
    let mut files_total = 0usize;
    let mut bytes_total = 0u64;

    for raw_path in paths {
        check_transfer_control(&mut on_control)?;
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            continue;
        }

        let source = Path::new(trimmed);
        if source.file_name().is_none() {
            continue;
        }
        let work = estimate_manifest_work(source, &mut on_control)?;
        files_total = files_total.saturating_add(work.file_count);
        bytes_total = bytes_total.saturating_add(work.byte_count);
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
        delete_discovery: None,
    })
}

pub(crate) fn plan_transfer_job(
    paths: &[String],
    destination: &str,
    options: Option<&TransferOptions>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<PlannedTransferJob, String> {
    let target_path = validate_destination(destination)?;
    // Undo validates each item just before the move. An item that went away
    // must fail its own receipt without blocking the rest of the batch.
    if options.is_some_and(|options| options.expected_sources.is_some()) {
        return Ok(plan_root_only_job(paths));
    }
    let roots_total = requested_roots(paths);
    let mut files_total = 0usize;
    let mut bytes_total = 0u64;
    let mut used_manifest_fallback = false;

    for raw_path in paths {
        let Some(strategy) =
            classify_transfer_root(raw_path, &target_path, options, &mut on_control)?
        else {
            continue;
        };

        if strategy.use_fast_move {
            continue;
        }

        let work = estimate_manifest_work(&strategy.source, &mut on_control)?;
        used_manifest_fallback = true;
        files_total = files_total.saturating_add(work.file_count);
        bytes_total = bytes_total.saturating_add(work.byte_count);
    }

    let progress_kind = if used_manifest_fallback {
        TransferProgressKind::Files
    } else {
        TransferProgressKind::Roots
    };
    let (files_total, bytes_total) = match progress_kind {
        TransferProgressKind::Roots => (None, None),
        TransferProgressKind::Files => (Some(files_total), Some(bytes_total)),
        TransferProgressKind::Items => (Some(files_total), Some(bytes_total)),
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
        delete_discovery: None,
    })
}

pub(crate) fn plan_delete_job(
    paths: &[String],
    on_progress: Option<&mut DeleteDiscoveryProgressCallback>,
    on_control: Option<&mut TransferControlCallback>,
) -> Result<PlannedTransferJob, String> {
    plan_delete_like_job(paths, on_progress, on_control)
}

pub(crate) fn plan_trash_job(
    paths: &[String],
    on_progress: Option<&mut DeleteDiscoveryProgressCallback>,
    on_control: Option<&mut TransferControlCallback>,
) -> Result<PlannedTransferJob, String> {
    plan_delete_like_job(paths, on_progress, on_control)
}

fn plan_delete_like_job(
    paths: &[String],
    on_progress: Option<&mut DeleteDiscoveryProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<PlannedTransferJob, String> {
    check_transfer_control(&mut on_control)?;
    let roots_total = requested_roots(paths);
    let discovery = discover_delete_plan(paths, on_progress, on_control)?;

    Ok(PlannedTransferJob {
        work: TransferWorkEstimate {
            roots_total,
            roots_completed: 0,
            files_total: Some(discovery.item_count),
            files_completed: 0,
            bytes_total: Some(discovery.byte_count),
            bytes_completed: 0,
        },
        progress_kind: TransferProgressKind::Items,
        delete_discovery: Some(discovery),
    })
}
