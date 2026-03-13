// Worker lifecycle and execution helpers for the transfer manager queue.
use super::control::{TransferJobControlHandle, TRANSFER_CANCELLED_MESSAGE};
use super::manager_events::TransferEventEmitter;
use super::manager_state::{
    snapshot_from_state, ActiveTransferJobState, ActiveTransferRuntimeProgress,
    TransferJobRequest, TransferManagerInner, TransferOperation, TransferOperationOutcome,
    TransferOperationResult,
};
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::job_plan::{
    plan_copy_job, plan_root_only_job, plan_transfer_job, PlannedTransferJob,
    TransferProgressKind,
};
use crate::domain::filesystem::transfer::types::{TransferJobPhase, TransferJobStatus};
use crate::domain::media::conversion_jobs;
use std::sync::Arc;
use std::thread;

pub(super) fn start_worker(inner: Arc<TransferManagerInner>) {
    let worker = move || loop {
        let Some(job) = wait_for_next_job(&inner) else {
            return;
        };
        run_job(&inner, job);
    };

    let _ = thread::Builder::new()
        .name("transfer-manager".to_string())
        .spawn(worker);
}

fn wait_for_next_job(inner: &Arc<TransferManagerInner>) -> Option<TransferJobRequest> {
    let mut guard = inner.state.lock().ok()?;
    loop {
        if let Some(job) = guard.queued_jobs.pop_front() {
            return Some(job);
        }
        guard = inner.queue_signal.wait(guard).ok()?;
    }
}

fn run_job(inner: &Arc<TransferManagerInner>, job: TransferJobRequest) {
    activate_job(inner, &job);

    let plan = {
        let control = job.control.clone();
        let mut on_control = move || control.checkpoint();
        match plan_job(&job.operation, Some(&mut on_control)) {
            Ok(plan) => {
                apply_job_plan(inner, &job.snapshot.id, &plan, &job.event_emitter);
                mark_job_executing(inner, &job.snapshot.id, &job.event_emitter);
                plan
            }
            Err(error) => {
                let terminal_status = terminal_status_for_error(&error);
                mark_job_finished(inner, &job.snapshot.id, terminal_status, &job.event_emitter);
                let _ = job.completion_tx.send(Err(error));
                return;
            }
        }
    };

    let outcome = match job.operation {
        TransferOperation::Copy {
            paths,
            destination,
            options,
        } => execute_copy_job(
            inner,
            &job.snapshot.id,
            &plan,
            &job.event_emitter,
            job.control.clone(),
            paths,
            destination,
            options,
        ),
        TransferOperation::Transfer {
            paths,
            destination,
            options,
        } => execute_transfer_job(
            inner,
            &job.snapshot.id,
            &plan,
            &job.event_emitter,
            job.control.clone(),
            paths,
            destination,
            options,
        ),
        TransferOperation::Delete { paths } => execute_delete_job(
            inner,
            &job.snapshot.id,
            &plan,
            &job.event_emitter,
            job.control.clone(),
            paths,
        ),
        TransferOperation::Trash { paths } => execute_trash_job(
            inner,
            &job.snapshot.id,
            &plan,
            &job.event_emitter,
            job.control.clone(),
            paths,
        ),
        TransferOperation::Conversion { items } => execute_conversion_job(
            inner,
            &job.snapshot.id,
            &plan,
            &job.event_emitter,
            job.control.clone(),
            items,
        ),
    };

    mark_job_finished(
        inner,
        &job.snapshot.id,
        outcome.terminal_status,
        &job.event_emitter,
    );
    let _ = job.completion_tx.send(outcome.result);
}

fn terminal_status_for_error(error: &str) -> TransferJobStatus {
    if error == TRANSFER_CANCELLED_MESSAGE {
        TransferJobStatus::Cancelled
    } else {
        TransferJobStatus::Failed
    }
}

fn plan_job(
    operation: &TransferOperation,
    on_control: Option<&mut fs::TransferControlCallback>,
) -> Result<PlannedTransferJob, String> {
    match operation {
        TransferOperation::Copy {
            paths,
            destination,
            options,
        } => plan_copy_job(paths, destination, options.as_ref(), on_control),
        TransferOperation::Transfer {
            paths,
            destination,
            options,
        } => plan_transfer_job(paths, destination, options.as_ref(), on_control),
        TransferOperation::Delete { paths } | TransferOperation::Trash { paths } => {
            Ok(plan_root_only_job(paths))
        }
        TransferOperation::Conversion { items } => {
            let source_paths = items
                .iter()
                .map(|item| item.source_path().to_string())
                .collect::<Vec<_>>();
            Ok(plan_root_only_job(&source_paths))
        }
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
    let manager = Arc::clone(inner);
    let manager_job_id = job_id.to_string();
    let progress_kind = plan.progress_kind;
    let event_emitter = event_emitter.clone();
    let mut callback = move |update: fs::TransferProgressUpdate| {
        update_running_progress(
            &manager,
            &manager_job_id,
            progress_kind,
            &update,
            &event_emitter,
        );
        event_emitter.emit(&update);
    };
    let mut on_control = move || control.checkpoint();
    let result = fs::copy_entries(
        paths,
        destination,
        options,
        Some(&mut callback),
        Some(&mut on_control),
    )
    .map(TransferOperationResult::Copy);

    let terminal_status = match &result {
        Ok(_) => TransferJobStatus::Completed,
        Err(error) => terminal_status_for_error(error),
    };

    TransferOperationOutcome {
        result,
        terminal_status,
    }
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
    let manager = Arc::clone(inner);
    let manager_job_id = job_id.to_string();
    let progress_kind = plan.progress_kind;
    let event_emitter = event_emitter.clone();
    let mut callback = move |update: fs::TransferProgressUpdate| {
        update_running_progress(
            &manager,
            &manager_job_id,
            progress_kind,
            &update,
            &event_emitter,
        );
        event_emitter.emit(&update);
    };
    let mut on_control = move || control.checkpoint();
    let result = fs::transfer_entries(
        paths,
        destination,
        options,
        Some(&mut callback),
        Some(&mut on_control),
    )
    .map(TransferOperationResult::Transfer);

    let terminal_status = match &result {
        Ok(_) => TransferJobStatus::Completed,
        Err(error) => terminal_status_for_error(error),
    };

    TransferOperationOutcome {
        result,
        terminal_status,
    }
}

fn execute_delete_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    paths: Vec<String>,
) -> TransferOperationOutcome {
    let manager = Arc::clone(inner);
    let manager_job_id = job_id.to_string();
    let progress_kind = plan.progress_kind;
    let event_emitter = event_emitter.clone();
    let mut callback = move |update: fs::TransferProgressUpdate| {
        update_running_progress(
            &manager,
            &manager_job_id,
            progress_kind,
            &update,
            &event_emitter,
        );
        event_emitter.emit(&update);
    };
    let mut on_control = move || control.checkpoint();
    match fs::delete_entries(paths, Some(&mut callback), Some(&mut on_control)) {
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
}

fn execute_trash_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    paths: Vec<String>,
) -> TransferOperationOutcome {
    let manager = Arc::clone(inner);
    let manager_job_id = job_id.to_string();
    let progress_kind = plan.progress_kind;
    let event_emitter = event_emitter.clone();
    let mut callback = move |update: fs::TransferProgressUpdate| {
        update_running_progress(
            &manager,
            &manager_job_id,
            progress_kind,
            &update,
            &event_emitter,
        );
        event_emitter.emit(&update);
    };
    let mut on_control = move || control.checkpoint();
    match fs::trash_entries(paths, Some(&mut callback), Some(&mut on_control)) {
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
}

fn execute_conversion_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    items: Vec<conversion_jobs::ConversionJobItem>,
) -> TransferOperationOutcome {
    let manager = Arc::clone(inner);
    let manager_job_id = job_id.to_string();
    let progress_kind = plan.progress_kind;
    let event_emitter = event_emitter.clone();
    let mut callback = move |update: fs::TransferProgressUpdate| {
        update_running_progress(
            &manager,
            &manager_job_id,
            progress_kind,
            &update,
            &event_emitter,
        );
        event_emitter.emit(&update);
    };
    let mut on_control = move || control.checkpoint();
    let result = conversion_jobs::convert_items(
        items,
        Some(&mut callback),
        Some(&mut on_control),
    )
    .map(TransferOperationResult::Conversion);

    let terminal_status = match &result {
        Ok(_) => TransferJobStatus::Completed,
        Err(error) => terminal_status_for_error(error),
    };

    TransferOperationOutcome {
        result,
        terminal_status,
    }
}

fn activate_job(inner: &Arc<TransferManagerInner>, job: &TransferJobRequest) {
    let snapshot = {
        let mut guard = match inner.state.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let mut snapshot = job.snapshot.clone();
        snapshot.status = TransferJobStatus::Running;
        snapshot.phase = TransferJobPhase::Planning;
        guard.active_job = Some(ActiveTransferJobState {
            snapshot,
            runtime: None,
            control: job.control.clone(),
            event_emitter: job.event_emitter.clone(),
        });
        snapshot_from_state(&guard)
    };
    job.event_emitter.emit_snapshot(&snapshot);
}

fn apply_job_plan(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
) {
    let snapshot = {
        let mut guard = match inner.state.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(active) = guard.active_job.as_mut() else {
            return;
        };
        if active.snapshot.id != job_id {
            return;
        }

        active.snapshot.work = plan.work.clone();
        active.runtime = Some(ActiveTransferRuntimeProgress::from_plan(plan));
        snapshot_from_state(&guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}

fn mark_job_executing(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    event_emitter: &TransferEventEmitter,
) {
    let snapshot = {
        let mut guard = match inner.state.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(active) = guard.active_job.as_mut() else {
            return;
        };
        if active.snapshot.id != job_id {
            return;
        }

        active.snapshot.phase = TransferJobPhase::Executing;
        snapshot_from_state(&guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}

fn update_running_progress(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    progress_kind: TransferProgressKind,
    update: &fs::TransferProgressUpdate,
    event_emitter: &TransferEventEmitter,
) {
    let snapshot = {
        let mut guard = match inner.state.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(active) = guard.active_job.as_mut() else {
            return;
        };
        if active.snapshot.id != job_id {
            return;
        }

        active.snapshot.work.roots_total = update.total;
        active.snapshot.work.roots_completed = update.processed;
        if matches!(progress_kind, TransferProgressKind::Roots) {
            active.snapshot.work.files_total = None;
            active.snapshot.work.bytes_total = None;
            active.snapshot.work.files_completed = 0;
            active.snapshot.work.bytes_completed = 0;
        }
        active.snapshot.current_path = match update.current_path.clone() {
            Some(path) => Some(path),
            None => active.snapshot.current_path.clone(),
        };
        if let Some(runtime) = active.runtime.as_mut() {
            if runtime.progress_kind != Some(progress_kind) {
                runtime.progress_kind = Some(progress_kind);
            }
            runtime.update_snapshot(&mut active.snapshot, update);
        }
        snapshot_from_state(&guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}

fn mark_job_finished(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    status: TransferJobStatus,
    event_emitter: &TransferEventEmitter,
) {
    let snapshot = {
        let mut guard = match inner.state.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(mut active) = guard.active_job.take() else {
            return;
        };
        if active.snapshot.id != job_id {
            guard.active_job = Some(active);
            return;
        }

        if status == TransferJobStatus::Completed {
            if let Some(runtime) = active.runtime.as_mut() {
                runtime.finalize_success(&mut active.snapshot);
            }
            active.snapshot.work.roots_completed = active.snapshot.work.roots_total;
        }

        active.snapshot.status = status;
        active.snapshot.phase = TransferJobPhase::Finalizing;
        guard.completed_jobs.push_back(active.snapshot);
        while guard.completed_jobs.len() > super::manager_state::COMPLETED_JOB_HISTORY_LIMIT {
            guard.completed_jobs.pop_front();
        }
        snapshot_from_state(&guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}
