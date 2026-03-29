// Worker lifecycle orchestration for the transfer manager queue.
// Planning, execution, progress throttling, and state mutation live in sibling modules.
use super::job_execution::{run_operation, terminal_status_for_error};
use super::job_planning::plan_job;
use super::job_state_updates::{
    activate_job, apply_job_plan, mark_job_executing, mark_job_finished,
};
use super::manager_state::{TransferJobRequest, TransferManagerInner};
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
    let TransferJobRequest {
        snapshot,
        event_emitter,
        operation,
        completion_tx,
        control,
    } = job;

    let plan = {
        let planning_control = control.clone();
        let mut on_control = move || planning_control.checkpoint();
        match plan_job(
            inner,
            &snapshot.id,
            &event_emitter,
            &operation,
            Some(&mut on_control),
        ) {
            Ok(plan) => {
                apply_job_plan(inner, &snapshot.id, &plan, &event_emitter);
                mark_job_executing(inner, &snapshot.id, &event_emitter);
                plan
            }
            Err(error) => {
                let terminal_status = terminal_status_for_error(&error);
                mark_job_finished(inner, &snapshot.id, terminal_status, &event_emitter);
                let _ = completion_tx.send(Err(error));
                return;
            }
        }
    };

    let outcome = run_operation(inner, &snapshot.id, &plan, &event_emitter, control, operation);
    mark_job_finished(inner, &snapshot.id, outcome.terminal_status, &event_emitter);
    let _ = completion_tx.send(outcome.result);
}
