// Worker lifecycle orchestration for the transfer manager queue.
// Planning, execution, progress throttling, and state mutation live in sibling modules.
use super::job_execution::{run_operation, terminal_status_for_error};
use super::job_planning::plan_job;
use super::job_state_updates::{
    activate_job, mark_job_finished, mark_job_planning, mark_job_ready, mark_queued_job_finished,
};
use super::manager_state::{TransferJobRequest, TransferManagerInner};
use crate::domain::filesystem::transfer::job_plan::PlannedTransferJob;
use std::sync::Arc;
use std::thread;

const PLANNING_WORKER_COUNT: usize = 2;

pub(super) fn start_workers(inner: Arc<TransferManagerInner>) {
    for worker_index in 0..PLANNING_WORKER_COUNT {
        let planner_inner = Arc::clone(&inner);
        let planner = move || loop {
            let Some(job) = wait_for_next_planning_job(&planner_inner) else {
                return;
            };
            run_planning_job(&planner_inner, job);
        };

        let _ = thread::Builder::new()
            .name(format!("transfer-planner-{worker_index}"))
            .spawn(planner);
    }

    let worker = move || loop {
        let Some((job, plan)) = wait_for_next_ready_job(&inner) else {
            return;
        };
        run_job(&inner, job, plan);
    };

    let _ = thread::Builder::new()
        .name("transfer-executor".to_string())
        .spawn(worker);
}

fn wait_for_next_planning_job(inner: &Arc<TransferManagerInner>) -> Option<TransferJobRequest> {
    let mut guard = inner.state.lock().ok()?;
    loop {
        if let Some(job) = guard.claim_next_planning_job() {
            return Some(job);
        }
        guard = inner.queue_signal.wait(guard).ok()?;
    }
}

fn run_planning_job(inner: &Arc<TransferManagerInner>, job: TransferJobRequest) {
    mark_job_planning(inner, &job.snapshot.id, &job.event_emitter);

    let plan_result = {
        let planning_control = job.control.clone();
        let mut on_control = move || planning_control.checkpoint();
        plan_job(
            inner,
            &job.snapshot.id,
            &job.event_emitter,
            &job.operation,
            Some(&mut on_control),
        )
    };

    match plan_result {
        Ok(plan) => {
            mark_job_ready(inner, &job.snapshot.id, plan, &job.event_emitter);
            inner.queue_signal.notify_all();
        }
        Err(error) => {
            let terminal_status = terminal_status_for_error(&error);
            if let Some(request) = mark_queued_job_finished(
                inner,
                &job.snapshot.id,
                terminal_status,
                &job.event_emitter,
            ) {
                let _ = request.completion_tx.send(Err(error));
            }
        }
    }
}

fn wait_for_next_ready_job(
    inner: &Arc<TransferManagerInner>,
) -> Option<(TransferJobRequest, PlannedTransferJob)> {
    let mut guard = inner.state.lock().ok()?;
    loop {
        if let Some(job) = guard.take_next_ready_job() {
            return Some(job);
        }
        guard = inner.queue_signal.wait(guard).ok()?;
    }
}

fn run_job(inner: &Arc<TransferManagerInner>, job: TransferJobRequest, plan: PlannedTransferJob) {
    activate_job(inner, &job, &plan);
    let TransferJobRequest {
        snapshot,
        event_emitter,
        operation,
        completion_tx,
        control,
    } = job;

    let outcome = run_operation(
        inner,
        &snapshot.id,
        &plan,
        &event_emitter,
        control,
        operation,
    );
    mark_job_finished(inner, &snapshot.id, outcome.terminal_status, &event_emitter);
    let _ = completion_tx.send(outcome.result);
}
