// Backend planning for managed transfer jobs.
// The queue uses this to compute stable work estimates before execution starts.
use super::common::{check_transfer_control, same_drive, unique_destination};
use super::types::TransferWorkEstimate;
use crate::domain::filesystem::{
    CopyOptions, TransferControlCallback, TransferMode, TransferOptions,
};
use std::fs;
use std::path::{Path, PathBuf};

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

#[derive(Clone, Copy, Default)]
struct PathWork {
    file_count: usize,
    byte_count: u64,
}

fn count_path_work(
    path: &Path,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<PathWork, String> {
    check_transfer_control(on_control)?;
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        let mut work = PathWork::default();
        for entry in fs::read_dir(path).map_err(|err| err.to_string())? {
            check_transfer_control(on_control)?;
            let entry = entry.map_err(|err| err.to_string())?;
            let nested = count_path_work(&entry.path(), on_control)?;
            work.file_count += nested.file_count;
            work.byte_count = work.byte_count.saturating_add(nested.byte_count);
        }
        return Ok(work);
    }

    Ok(PathWork {
        file_count: 1,
        byte_count: metadata.len(),
    })
}

fn validate_destination(destination: &str) -> Result<PathBuf, String> {
    let target = destination.trim();
    if target.is_empty() {
        return Err("Empty destination".to_string());
    }
    let target_path = PathBuf::from(target);
    if !target_path.exists() {
        return Err("Destination does not exist".to_string());
    }
    if !target_path.is_dir() {
        return Err("Destination is not a folder".to_string());
    }
    Ok(target_path)
}

fn requested_roots(paths: &[String]) -> usize {
    paths
        .iter()
        .filter(|value| !value.trim().is_empty())
        .count()
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

fn build_copy_destination(src: &Path, target_path: &Path) -> Option<PathBuf> {
    let name = src.file_name()?;
    let default_dest = target_path.join(name);
    let is_same_directory_copy = src
        .parent()
        .map(|parent| super::common::same_path(parent, target_path))
        .unwrap_or(false);

    if is_same_directory_copy {
        return Some(unique_destination(&default_dest));
    }

    Some(default_dest)
}

fn build_transfer_destination(src: &Path, target_path: &Path) -> Option<PathBuf> {
    let name = src.file_name()?;
    Some(target_path.join(name))
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

        let src = PathBuf::from(trimmed);
        if build_copy_destination(&src, &target_path).is_none() {
            continue;
        }

        let Ok(work) = count_path_work(&src, &mut on_control) else {
            continue;
        };
        files_total += work.file_count;
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

        let src = PathBuf::from(trimmed);
        if build_transfer_destination(&src, &target_path).is_none() {
            continue;
        }

        let should_move = match requested_mode {
            TransferMode::Copy => false,
            TransferMode::Move => true,
            TransferMode::Auto => same_drive(&src, &target_path),
        };

        // Same-drive moves may complete as a single rename, so keep the job's
        // aggregate progress coarse instead of promising file-level totals.
        if should_move && same_drive(&src, &target_path) {
            progress_kind = TransferProgressKind::Roots;
        }

        let Ok(work) = count_path_work(&src, &mut on_control) else {
            continue;
        };
        files_total += work.file_count;
        bytes_total = bytes_total.saturating_add(work.byte_count);
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
