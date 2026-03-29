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

pub(super) fn terminal_status_for_error(error: &str) -> TransferJobStatus {
    if error == TRANSFER_CANCELLED_MESSAGE {
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
        let result = fs::transfer_entries(
            paths,
            destination,
            options,
            Some(callback),
            Some(&mut on_control),
        )
        .map(TransferOperationResult::Transfer);

        TransferOperationOutcome {
            terminal_status: completed_status_for_result(&result),
            result,
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
        let result = conversion_jobs::convert_items(items, Some(callback), Some(&mut on_control))
            .map(TransferOperationResult::Conversion);

        TransferOperationOutcome {
            terminal_status: completed_status_for_result(&result),
            result,
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
    let callback_dispatcher = Arc::clone(&dispatcher);
    let mut callback = move |update: fs::TransferProgressUpdate| {
        if let Ok(mut dispatcher) = callback_dispatcher.lock() {
            dispatcher.handle_update(update);
        }
    };

    let outcome = run(&mut callback);

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
