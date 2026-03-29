// Transfer planning for queued jobs.
// Delete and trash planning stay here because they need discovery-time UI feedback.
use super::manager_events::TransferEventEmitter;
use super::manager_state::{TransferManagerInner, TransferOperation};
use super::progress_dispatch::PlanningProgressDispatcher;
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::delete_discovery::DeleteDiscoveryProgress;
use crate::domain::filesystem::transfer::job_plan::{
    plan_copy_job, plan_delete_job, plan_root_only_job, plan_transfer_job, plan_trash_job,
    PlannedTransferJob,
};
use std::sync::{Arc, Mutex};

pub(super) fn plan_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    event_emitter: &TransferEventEmitter,
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
        TransferOperation::Delete { paths } => {
            plan_delete_job_with_feedback(inner, job_id, event_emitter, paths, "delete", on_control)
        }
        TransferOperation::Trash { paths } => plan_delete_job_with_feedback(
            inner,
            job_id,
            event_emitter,
            paths,
            "recycle",
            on_control,
        ),
        TransferOperation::Conversion { items } => {
            let source_paths = items
                .iter()
                .map(|item| item.source_path().to_string())
                .collect::<Vec<_>>();
            Ok(plan_root_only_job(&source_paths))
        }
    }
}

fn plan_delete_job_with_feedback(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    event_emitter: &TransferEventEmitter,
    paths: &[String],
    operation_label: &'static str,
    on_control: Option<&mut fs::TransferControlCallback>,
) -> Result<PlannedTransferJob, String> {
    let dispatcher = Arc::new(Mutex::new(PlanningProgressDispatcher::new(
        Arc::clone(inner),
        job_id.to_string(),
        event_emitter.clone(),
        operation_label,
    )));
    if let Ok(mut dispatcher) = dispatcher.lock() {
        dispatcher.emit_initial();
    }

    let callback_dispatcher = Arc::clone(&dispatcher);
    let mut on_progress = move |update: DeleteDiscoveryProgress| {
        if let Ok(mut dispatcher) = callback_dispatcher.lock() {
            dispatcher.handle_update(update);
        }
    };

    let result = if operation_label == "delete" {
        plan_delete_job(paths, Some(&mut on_progress), on_control)
    } else {
        plan_trash_job(paths, Some(&mut on_progress), on_control)
    };

    if let Ok(mut dispatcher) = dispatcher.lock() {
        dispatcher.flush_all();
    }

    result
}
