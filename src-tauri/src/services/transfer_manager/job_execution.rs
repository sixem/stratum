// Operation execution for planned transfer jobs.
// The coordinator hands us a planned job and a concrete operation, and we own the per-operation run details.
use super::control::{TransferJobControlHandle, TRANSFER_CANCELLED_MESSAGE};
use super::manager_events::TransferEventEmitter;
use super::manager_state::{
    TransferManagerInner, TransferOperation, TransferOperationOutcome, TransferOperationResult,
};
use super::progress_dispatch::TransferProgressDispatcher;
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::job_plan::PlannedTransferJob;
use crate::domain::filesystem::transfer::types::TransferJobStatus;
use crate::domain::media::conversion_jobs;
use std::sync::{Arc, Mutex};

pub(super) fn run_operation(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    operation: TransferOperation,
) -> TransferOperationOutcome {
    match operation {
        #[cfg(windows)]
        TransferOperation::Remote(job) => {
            execute_remote_job(inner, job_id, plan, event_emitter, control, job)
        }
        #[cfg(windows)]
        TransferOperation::RemoteBatch(batch) => {
            execute_remote_batch(inner, job_id, plan, event_emitter, control, batch)
        }
        #[cfg(windows)]
        TransferOperation::RemoteDelete(job) => {
            execute_remote_delete(inner, job_id, plan, event_emitter, control, job)
        }
        TransferOperation::Copy {
            paths,
            destination,
            options,
        } => execute_copy_job(
            inner,
            job_id,
            plan,
            event_emitter,
            control,
            paths,
            destination,
            options,
        ),
        TransferOperation::Transfer {
            paths,
            destination,
            options,
            #[cfg(windows)]
                drop_stage: _drop_stage,
        } => execute_transfer_job(
            inner,
            job_id,
            plan,
            event_emitter,
            control,
            paths,
            destination,
            options,
        ),
        TransferOperation::Delete { paths } => {
            execute_delete_job(inner, job_id, plan, event_emitter, control, paths)
        }
        TransferOperation::Trash { paths } => {
            execute_trash_job(inner, job_id, plan, event_emitter, control, paths)
        }
        TransferOperation::Conversion { items } => {
            execute_conversion_job(inner, job_id, plan, event_emitter, control, items)
        }
    }
}

#[cfg(windows)]
fn execute_remote_delete(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    job: crate::services::remotes::operations::RemoteDelete,
) -> TransferOperationOutcome {
    run_with_progress_dispatcher(inner, job_id, plan, event_emitter, move |callback| {
        let report = tauri::async_runtime::block_on(async {
            let mut report = fs::DeleteReport {
                deleted: 0,
                skipped: 0,
                cancelled: false,
                failures: Vec::new(),
            };
            for (index, entry) in job.entries.iter().enumerate() {
                if control.checkpoint().is_err() {
                    report.cancelled = true;
                    break;
                }
                callback(fs::TransferProgressUpdate {
                    processed: index,
                    total: job.entries.len(),
                    current_path: Some(format!(
                        "{}/{}",
                        job.parent.trim_end_matches('/'),
                        entry.name
                    )),
                    status_text: Some("Deleting".into()),
                    ..Default::default()
                });
                match crate::services::remotes::operations::delete_managed(
                    &job.remotes,
                    &job.profile,
                    job.session,
                    &job.parent,
                    entry,
                    &job.journal,
                    &mut || control.checkpoint(),
                )
                .await
                {
                    Ok(()) => report.deleted += 1,
                    Err(error) if error.starts_with(TRANSFER_CANCELLED_MESSAGE) => {
                        report.cancelled = true;
                        if error != TRANSFER_CANCELLED_MESSAGE {
                            report.failures.push(format!("{}: {error}", entry.name));
                        }
                        break;
                    }
                    Err(error) => report.failures.push(format!("{}: {error}", entry.name)),
                }
                (job.source_changed)(job.parent.clone());
            }
            (job.source_changed)(job.parent.clone());
            report
        });
        TransferOperationOutcome {
            terminal_status: if report.cancelled {
                TransferJobStatus::Cancelled
            } else if report.failures.is_empty() {
                TransferJobStatus::Completed
            } else {
                TransferJobStatus::Failed
            },
            result: Ok(TransferOperationResult::Delete(report)),
        }
    })
}

#[cfg(windows)]
fn execute_remote_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    job: crate::services::remotes::transfer::Transfer,
) -> TransferOperationOutcome {
    use crate::services::remotes::transfer::{Direction, TransferResult};
    run_with_progress_dispatcher(inner, job_id, plan, event_emitter, move |callback| {
        if let Direction::Rename {
            parent,
            destination,
            entries,
        } = &job.direction
        {
            let report = crate::services::remotes::transfer::batch_move::collect_moves(
                entries,
                || control.checkpoint(),
                |index, entry| {
                    callback(fs::TransferProgressUpdate {
                        processed: index,
                        total: entries.len(),
                        current_path: Some(format!(
                            "{}/{}",
                            parent.trim_end_matches('/'),
                            entry.name
                        )),
                        status_text: Some("Moving".into()),
                        ..Default::default()
                    });
                    let result = tauri::async_runtime::block_on(
                        crate::services::remotes::operations::move_entry(
                            &job.remotes,
                            &job.profile,
                            job.session,
                            parent,
                            destination,
                            entry,
                        ),
                    );
                    if let Some(notify) = &job.source_changed {
                        notify(parent.clone());
                        notify(destination.clone());
                    }
                    callback(fs::TransferProgressUpdate {
                        processed: index + 1,
                        total: entries.len(),
                        current_path: Some(format!(
                            "{}/{}",
                            parent.trim_end_matches('/'),
                            entry.name
                        )),
                        status_text: Some("Moving".into()),
                        ..Default::default()
                    });
                    result.map(|()| TransferResult {
                        path: format!("{}/{}", destination.trim_end_matches('/'), entry.name),
                        backup: None,
                        warning: None,
                        local_path: None,
                    })
                },
            );
            let failed = report.items.iter().any(|item| item.error.is_some());
            return TransferOperationOutcome {
                terminal_status: if report.cancelled {
                    TransferJobStatus::Cancelled
                } else if failed {
                    TransferJobStatus::Failed
                } else {
                    TransferJobStatus::Completed
                },
                result: Ok(TransferOperationResult::RemoteBatch(report)),
            };
        }
        let (path, mut label) = match &job.direction {
            Direction::Download { remote_path, .. } => (remote_path.clone(), "Downloading"),
            Direction::Upload { local_path, .. } => {
                (local_path.to_string_lossy().into_owned(), "Uploading")
            }
            Direction::Remote { remote_path, .. } => (remote_path.clone(), "Copying"),
            Direction::Rename { .. } => unreachable!(),
        };
        if job.moving {
            label = "Moving";
        }
        let mut on_control = || control.checkpoint();
        let mut on_progress = |done, total| {
            callback(fs::TransferProgressUpdate {
                processed: 0,
                total: 1,
                current_path: Some(path.clone()),
                current_bytes: Some(done),
                current_total_bytes: (total > 0).then_some(total),
                status_text: Some(label.into()),
                ..Default::default()
            })
        };
        let result = run_remote_item(&job, &mut on_control, &mut on_progress).map(|mut result| {
            if matches!(job.direction, Direction::Download { .. }) {
                result.local_path = Some(std::path::PathBuf::from(&result.path));
            }
            TransferOperationResult::Remote(result)
        });
        TransferOperationOutcome {
            terminal_status: completed_status_for_result(&result),
            result,
        }
    })
}

#[cfg(windows)]
fn execute_remote_batch(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    batch: crate::services::remotes::transfer::TransferBatch,
) -> TransferOperationOutcome {
    use crate::services::remotes::transfer::{
        BatchItemResult, BatchResult, Direction, RECOVERY_CANCELLED_PREFIX,
    };
    run_with_progress_dispatcher(inner, job_id, plan, event_emitter, move |callback| {
        let total = batch.items.len();
        let mut items = Vec::with_capacity(total);
        let mut cancelled = false;
        callback(fs::TransferProgressUpdate {
            processed: 0,
            total,
            status_text: Some("Checking destinations".into()),
            ..Default::default()
        });
        let checked = crate::services::remotes::transfer::preflight::check_conflicts(
            &batch.items,
            &mut || control.checkpoint(),
            &mut |index| {
                callback(fs::TransferProgressUpdate {
                    processed: 0,
                    total,
                    status_text: Some(format!("Checking destinations ({}/{total})", index + 1)),
                    ..Default::default()
                })
            },
        );
        let checks = match checked {
            Ok(checks) => checks,
            Err(error) => {
                return TransferOperationOutcome {
                    terminal_status: terminal_status_for_error(&error),
                    result: Err(error),
                }
            }
        };
        let conflicts: Vec<usize> = checks
            .iter()
            .enumerate()
            .filter_map(|(index, result)| matches!(result, Ok(true)).then_some(index))
            .collect();
        let moving = batch.items[0].moving;
        let decision = if conflicts.is_empty() || moving {
            crate::services::remotes::transfer::preflight::Decision::Skip
        } else {
            callback(fs::TransferProgressUpdate {
                processed: 0,
                total,
                status_text: Some("Waiting for replacement choice".into()),
                ..Default::default()
            });
            let decision = (batch.request_decision)(conflicts.clone())
                .and_then(|pending| pending.wait(&mut || control.checkpoint()));
            match decision {
                Ok(decision) => decision,
                Err(error) => {
                    return TransferOperationOutcome {
                        terminal_status: terminal_status_for_error(&error),
                        result: Err(error),
                    }
                }
            }
        };
        if matches!(
            decision,
            crate::services::remotes::transfer::preflight::Decision::Cancel
        ) {
            return TransferOperationOutcome {
                terminal_status: TransferJobStatus::Cancelled,
                result: Ok(TransferOperationResult::RemoteBatch(BatchResult {
                    items,
                    cancelled: true,
                })),
            };
        }
        let mut last_boundary_flush: Option<std::time::Instant> = None;
        for (index, job) in batch.items.iter().enumerate() {
            if let Err(error) = control.checkpoint() {
                cancelled = terminal_status_for_error(&error) == TransferJobStatus::Cancelled;
                if !cancelled {
                    items.push(BatchItemResult {
                        index,
                        result: None,
                        error: Some(error),
                        skipped: false,
                    });
                }
                break;
            }
            let replace = match &checks[index] {
                Err(error) => {
                    items.push(BatchItemResult {
                        index,
                        result: None,
                        error: Some(error.clone()),
                        skipped: false,
                    });
                    (batch.item_finished)(index);
                    callback(fs::TransferProgressUpdate {
                        processed: index + 1,
                        total,
                        status_text: Some("Checking destinations".into()),
                        ..Default::default()
                    });
                    continue;
                }
                Ok(true) if moving => {
                    items.push(BatchItemResult {
                        index,
                        result: None,
                        error: Some(
                            "An item with this name already exists in the destination.".into(),
                        ),
                        skipped: false,
                    });
                    (batch.item_finished)(index);
                    callback(fs::TransferProgressUpdate {
                        processed: index + 1,
                        total,
                        status_text: Some("Checking destinations".into()),
                        ..Default::default()
                    });
                    continue;
                }
                Ok(true)
                    if matches!(
                        decision,
                        crate::services::remotes::transfer::preflight::Decision::Skip
                    ) =>
                {
                    items.push(BatchItemResult {
                        index,
                        result: None,
                        error: None,
                        skipped: true,
                    });
                    (batch.item_finished)(index);
                    callback(fs::TransferProgressUpdate {
                        processed: index + 1,
                        total,
                        status_text: Some("Skipping existing items".into()),
                        ..Default::default()
                    });
                    continue;
                }
                Ok(conflict) => *conflict,
            };
            let path = match &job.direction {
                Direction::Download { remote_path, .. } | Direction::Remote { remote_path, .. } => {
                    remote_path.clone()
                }
                Direction::Upload { local_path, .. } => local_path.to_string_lossy().into_owned(),
                Direction::Rename { .. } => unreachable!(),
            };
            let label = if job.moving {
                "Moving"
            } else if matches!(&job.direction, Direction::Upload { .. }) {
                "Uploading"
            } else if matches!(&job.direction, Direction::Download { .. }) {
                "Downloading"
            } else {
                "Copying"
            };
            let mut on_control = || control.checkpoint();
            let mut on_progress = |done, bytes_total| {
                let fraction = if bytes_total > 0 {
                    (done as f64 / bytes_total as f64).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                callback(fs::TransferProgressUpdate {
                    processed: index,
                    total,
                    current_path: Some(path.clone()),
                    current_bytes: Some(done),
                    current_total_bytes: (bytes_total > 0).then_some(bytes_total),
                    progress_percent: Some((index as f64 + fraction) * 100.0 / total as f64),
                    status_text: Some(label.into()),
                    ..Default::default()
                });
            };
            let mut prepared = job.clone();
            prepared.replace = replace;
            let result = run_remote_item(&prepared, &mut on_control, &mut on_progress);
            let (result, error) = match result {
                Ok(mut result) => {
                    if matches!(&job.direction, Direction::Download { .. }) {
                        result.local_path = Some(std::path::PathBuf::from(&result.path));
                    }
                    (Some(result), None)
                }
                Err(error) => {
                    cancelled = error == TRANSFER_CANCELLED_MESSAGE
                        || error.starts_with(RECOVERY_CANCELLED_PREFIX);
                    (None, Some(error))
                }
            };
            items.push(BatchItemResult {
                index,
                result,
                error,
                skipped: false,
            });
            // Keep the first completion responsive without flooding the UI
            // with queue snapshots for large batches of tiny files.
            let now = std::time::Instant::now();
            let flush_snapshot = cancelled
                || index + 1 == total
                || last_boundary_flush.is_none_or(|last| {
                    now.duration_since(last) >= std::time::Duration::from_millis(250)
                });
            if flush_snapshot {
                last_boundary_flush = Some(now);
            }
            callback(fs::TransferProgressUpdate {
                processed: index + usize::from(!cancelled),
                total,
                current_path: Some(path),
                progress_percent: Some(
                    (index + usize::from(!cancelled)) as f64 * 100.0 / total as f64,
                ),
                status_text: Some(label.into()),
                flush_snapshot,
                ..Default::default()
            });
            (batch.item_finished)(index);
            if cancelled {
                break;
            }
        }
        let failed = items.iter().any(|item| item.error.is_some());
        let status = if cancelled {
            TransferJobStatus::Cancelled
        } else if failed {
            TransferJobStatus::Failed
        } else {
            TransferJobStatus::Completed
        };
        TransferOperationOutcome {
            terminal_status: status,
            result: Ok(TransferOperationResult::RemoteBatch(BatchResult {
                items,
                cancelled,
            })),
        }
    })
}

#[cfg(windows)]
fn run_remote_item(
    job: &crate::services::remotes::transfer::Transfer,
    on_control: &mut dyn FnMut() -> Result<(), String>,
    on_progress: &mut dyn FnMut(u64, u64),
) -> Result<crate::services::remotes::transfer::TransferResult, String> {
    use crate::services::remotes::transfer::{
        copy_remote_entry, download_entry, move_remote_entry, move_upload_file, replace_download,
        replace_upload, upload_entry, Direction, TransferResult,
    };
    tauri::async_runtime::block_on(async {
        match &job.direction {
            Direction::Download { remote_path, .. } | Direction::Remote { remote_path, .. }
                if job.moving =>
            {
                move_remote_entry(job, remote_path, on_control, on_progress).await
            }
            Direction::Download {
                remote_path,
                local_folder,
            } if job.replace => {
                replace_download(
                    &job.remotes,
                    &job.profile,
                    job.session,
                    remote_path,
                    local_folder,
                    on_control,
                    on_progress,
                )
                .await
            }
            Direction::Download {
                remote_path,
                local_folder,
            } => download_entry(
                &job.remotes,
                &job.profile,
                job.session,
                remote_path,
                local_folder,
                on_control,
                on_progress,
            )
            .await
            .map(|path| TransferResult {
                path: path.to_string_lossy().into_owned(),
                backup: None,
                warning: None,
                local_path: None,
            }),
            Direction::Upload {
                local_path,
                remote_folder,
            } if job.moving => {
                move_upload_file(
                    &job.remotes,
                    &job.profile,
                    job.session,
                    local_path,
                    remote_folder,
                    on_control,
                    on_progress,
                )
                .await
            }
            Direction::Upload {
                local_path,
                remote_folder,
            } if job.replace => {
                replace_upload(
                    &job.remotes,
                    &job.profile,
                    job.session,
                    local_path,
                    remote_folder,
                    on_control,
                    on_progress,
                )
                .await
            }
            Direction::Upload {
                local_path,
                remote_folder,
            } => upload_entry(
                &job.remotes,
                &job.profile,
                job.session,
                local_path,
                remote_folder,
                on_control,
                on_progress,
            )
            .await
            .map(|path| TransferResult {
                path,
                backup: None,
                warning: None,
                local_path: None,
            }),
            Direction::Remote { .. } => copy_remote_entry(job, on_control, on_progress).await,
            Direction::Rename { .. } => unreachable!(),
        }
    })
}

pub(super) fn terminal_status_for_error(error: &str) -> TransferJobStatus {
    // A staged remote move includes recovery guidance after cancellation.
    #[cfg(windows)]
    let recovery_cancelled =
        error.starts_with(crate::services::remotes::transfer::RECOVERY_CANCELLED_PREFIX);
    #[cfg(not(windows))]
    let recovery_cancelled = false;
    if error == TRANSFER_CANCELLED_MESSAGE || recovery_cancelled {
        TransferJobStatus::Cancelled
    } else {
        TransferJobStatus::Failed
    }
}

fn execute_copy_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    paths: Vec<String>,
    destination: String,
    options: Option<fs::CopyOptions>,
) -> TransferOperationOutcome {
    run_with_progress_dispatcher(inner, job_id, plan, event_emitter, move |callback| {
        let mut on_control = move || control.checkpoint();
        let result = fs::copy_entries(
            paths,
            destination,
            options,
            Some(callback),
            Some(&mut on_control),
        )
        .map(TransferOperationResult::Copy);

        TransferOperationOutcome {
            terminal_status: completed_status_for_result(&result),
            result,
        }
    })
}

fn execute_transfer_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    paths: Vec<String>,
    destination: String,
    options: Option<fs::TransferOptions>,
) -> TransferOperationOutcome {
    run_with_progress_dispatcher(inner, job_id, plan, event_emitter, move |callback| {
        let mut on_control = move || control.checkpoint();
        match fs::transfer_entries(
            paths,
            destination,
            options,
            Some(callback),
            Some(&mut on_control),
        ) {
            Ok(report) => TransferOperationOutcome {
                terminal_status: if report.cancelled {
                    TransferJobStatus::Cancelled
                } else {
                    TransferJobStatus::Completed
                },
                result: Ok(TransferOperationResult::Transfer(report)),
            },
            Err(error) => TransferOperationOutcome {
                terminal_status: terminal_status_for_error(&error),
                result: Err(error),
            },
        }
    })
}

fn execute_delete_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    paths: Vec<String>,
) -> TransferOperationOutcome {
    run_with_progress_dispatcher(inner, job_id, plan, event_emitter, move |callback| {
        let mut on_control = move || control.checkpoint();
        match fs::delete_entries(
            paths,
            plan.delete_discovery.as_ref(),
            Some(callback),
            Some(&mut on_control),
        ) {
            Ok(report) => TransferOperationOutcome {
                terminal_status: if report.cancelled {
                    TransferJobStatus::Cancelled
                } else {
                    TransferJobStatus::Completed
                },
                result: Ok(TransferOperationResult::Delete(report)),
            },
            Err(error) => TransferOperationOutcome {
                terminal_status: terminal_status_for_error(&error),
                result: Err(error),
            },
        }
    })
}

fn execute_trash_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    paths: Vec<String>,
) -> TransferOperationOutcome {
    run_with_progress_dispatcher(inner, job_id, plan, event_emitter, move |callback| {
        let mut on_control = move || control.checkpoint();
        match fs::trash_entries(
            paths,
            plan.delete_discovery.as_ref(),
            Some(callback),
            Some(&mut on_control),
        ) {
            Ok(report) => TransferOperationOutcome {
                terminal_status: if report.cancelled {
                    TransferJobStatus::Cancelled
                } else {
                    TransferJobStatus::Completed
                },
                result: Ok(TransferOperationResult::Trash(report)),
            },
            Err(error) => TransferOperationOutcome {
                terminal_status: terminal_status_for_error(&error),
                result: Err(error),
            },
        }
    })
}

fn execute_conversion_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    items: Vec<conversion_jobs::ConversionJobItem>,
) -> TransferOperationOutcome {
    run_with_progress_dispatcher(inner, job_id, plan, event_emitter, move |callback| {
        let mut on_control = move || control.checkpoint();
        let result = conversion_jobs::convert_items(items, Some(callback), Some(&mut on_control));
        let terminal_status = match &result {
            Ok(report) if report.converted == 0 && report.failed > 0 => TransferJobStatus::Failed,
            _ => completed_status_for_result(&result),
        };

        TransferOperationOutcome {
            terminal_status,
            result: result.map(TransferOperationResult::Conversion),
        }
    })
}

fn run_with_progress_dispatcher<F>(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    run: F,
) -> TransferOperationOutcome
where
    F: FnOnce(&mut fs::TransferProgressCallback) -> TransferOperationOutcome,
{
    let dispatcher = Arc::new(Mutex::new(TransferProgressDispatcher::new(
        Arc::clone(inner),
        job_id.to_string(),
        plan.progress_kind,
        event_emitter.clone(),
    )));
    let progress_task = TransferProgressDispatcher::start_flush_task(&dispatcher);
    let callback_dispatcher = Arc::clone(&dispatcher);
    let mut callback = move |update: fs::TransferProgressUpdate| {
        if let Ok(mut dispatcher) = callback_dispatcher.lock() {
            let flush_snapshot = update.flush_snapshot;
            dispatcher.handle_update(update);
            if flush_snapshot {
                dispatcher.flush_all();
            }
        }
    };

    let outcome = run(&mut callback);

    progress_task.abort();
    if let Ok(mut dispatcher) = dispatcher.lock() {
        dispatcher.flush_all();
    }

    outcome
}

fn completed_status_for_result<T>(result: &Result<T, String>) -> TransferJobStatus {
    match result {
        Ok(_) => TransferJobStatus::Completed,
        Err(error) => terminal_status_for_error(error),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn cancellation_with_recovery_remains_cancelled() {
        let message = format!(
            "{}{}",
            crate::services::remotes::transfer::RECOVERY_CANCELLED_PREFIX,
            "/srv/file"
        );
        assert!(matches!(
            terminal_status_for_error(&message),
            TransferJobStatus::Cancelled
        ));
    }
}
