// Hard-delete helpers for permanently removing filesystem entries.
use super::transfer::delete_discovery::DeleteDiscoveryPlan;
use super::{DeleteReport, TransferControlCallback, TransferProgressCallback};

#[cfg(target_os = "windows")]
use super::transfer::native_delete_windows::{shell_delete_entries, ShellDeleteMode};
#[cfg(not(target_os = "windows"))]
use std::fs;
#[cfg(not(target_os = "windows"))]
use std::path::PathBuf;

pub(crate) fn delete_entries(
    paths: Vec<String>,
    discovery: Option<&DeleteDiscoveryPlan>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<DeleteReport, String> {
    #[cfg(target_os = "windows")]
    {
        let skipped = skipped_delete_paths(&paths);
        let report = shell_delete_entries(
            discovery,
            paths,
            ShellDeleteMode::Permanent,
            &mut on_progress,
            &mut on_control,
        )?;
        return Ok(DeleteReport {
            deleted: report.completed_paths.len(),
            skipped,
            cancelled: report.cancelled,
            failures: report.failures,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        legacy_delete_entries(paths, on_progress, on_control)
    }
}

fn skipped_delete_paths(paths: &[String]) -> usize {
    paths.iter().filter(|path| path.trim().is_empty()).count()
}

#[cfg(not(target_os = "windows"))]
fn legacy_delete_entries(
    paths: Vec<String>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<DeleteReport, String> {
    let mut report = DeleteReport {
        deleted: 0,
        skipped: 0,
        cancelled: false,
        failures: Vec::new(),
    };
    let total = paths.len();

    for (index, path) in paths.into_iter().enumerate() {
        if let Some(callback) = on_control.as_mut() {
            if let Err(error) = callback() {
                report.cancelled = true;
                if error.trim() != "Transfer cancelled" {
                    return Err(error);
                }
                break;
            }
        }

        let processed = index;
        let completed = index + 1;
        let trimmed = path.trim();
        if trimmed.is_empty() {
            report.skipped += 1;
            emit_delete_progress(&mut on_progress, completed, total, None);
            continue;
        }

        emit_delete_progress(
            &mut on_progress,
            processed,
            total,
            Some(trimmed.to_string()),
        );

        let target = PathBuf::from(trimmed);
        let metadata = match fs::metadata(&target) {
            Ok(value) => value,
            Err(err) => {
                report
                    .failures
                    .push(format!("{}: {}", trimmed, err.to_string()));
                emit_delete_progress(&mut on_progress, completed, total, None);
                continue;
            }
        };
        let hard_delete = || {
            if metadata.is_dir() {
                fs::remove_dir_all(&target)
            } else {
                fs::remove_file(&target)
            }
        };
        match hard_delete() {
            Ok(_) => report.deleted += 1,
            Err(err) => report
                .failures
                .push(format!("{}: {}", trimmed, err.to_string())),
        }
        emit_delete_progress(&mut on_progress, completed, total, None);
    }

    Ok(report)
}

#[cfg(not(target_os = "windows"))]
fn emit_delete_progress(
    on_progress: &mut Option<&mut TransferProgressCallback>,
    processed: usize,
    total: usize,
    current_path: Option<String>,
) {
    let Some(callback) = on_progress.as_mut() else {
        return;
    };
    callback(super::TransferProgressUpdate {
        processed,
        total,
        current_path,
        current_bytes: None,
        current_total_bytes: None,
        progress_percent: None,
        status_text: None,
        rate_text: None,
    });
}
