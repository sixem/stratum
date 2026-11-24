// Snapshot and runtime-state mutation helpers for transfer jobs.
// Keeping all queue-state writes here makes status transitions easier to reason about.
use super::manager_events::TransferEventEmitter;
use super::manager_state::{
    snapshot_from_state, QueuedTransferPlanningState, TransferJobRequest, TransferManagerInner,
    TransferOperationOutcome,
};
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::delete_discovery::DeleteDiscoveryProgress;
use crate::domain::filesystem::transfer::job_plan::{PlannedTransferJob, TransferProgressKind};
use crate::domain::filesystem::transfer::types::{
    TransferJobPhase, TransferJobStatus, TransferQueueSnapshot,
};
use std::sync::Arc;

pub(super) fn mark_job_planning(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    event_emitter: &TransferEventEmitter,
) {
    let snapshot = {
        let mut guard = match inner.state.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(queued) = guard.queued_job_mut(job_id) else {
            return;
        };

        queued.request.snapshot.status = TransferJobStatus::Running;
        queued.request.snapshot.phase = TransferJobPhase::Planning;
        queued.request.snapshot.current_path = None;
        snapshot_from_state(&mut guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}

pub(super) fn mark_job_ready(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
) {
    let snapshot = {
        let mut guard = match inner.state.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(queued) = guard.queued_job_mut(job_id) else {
            return;
        };

        queued.request.snapshot.status = TransferJobStatus::Queued;
        queued.request.snapshot.phase = TransferJobPhase::Ready;
        queued.request.snapshot.current_path = None;
        queued.request.snapshot.work = plan.work.clone();
        queued.planning_state = QueuedTransferPlanningState::Ready(plan);
        snapshot_from_state(&mut guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}

pub(super) fn apply_running_progress(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    progress_kind: TransferProgressKind,
    update: &fs::TransferProgressUpdate,
    include_snapshot: bool,
) -> Option<TransferQueueSnapshot> {
    let mut guard = inner.state.lock().ok()?;
    let active = guard.active_job_mut(job_id)?;

    match progress_kind {
        TransferProgressKind::Roots | TransferProgressKind::Files => {
            active.snapshot.work.roots_total = update.total;
            active.snapshot.work.roots_completed = update.processed;
            if matches!(progress_kind, TransferProgressKind::Roots) {
                active.snapshot.work.files_total = None;
                active.snapshot.work.bytes_total = None;
                active.snapshot.work.files_completed = 0;
                active.snapshot.work.bytes_completed = 0;
            }
        }
        TransferProgressKind::Items => {
            if update.completed_item.is_some() {
                active.snapshot.work.roots_completed = active
                    .snapshot
                    .work
                    .roots_completed
                    .saturating_add(1)
                    .min(active.snapshot.work.roots_total);
            }
        }
    }

    if let Some(path) = &update.current_path {
        active.snapshot.current_path = Some(path.clone());
    }

    if let Some(runtime) = active.runtime.as_mut() {
        if runtime.progress_kind != Some(progress_kind) {
            runtime.progress_kind = Some(progress_kind);
        }
        runtime.update_snapshot(&mut active.snapshot, update);
    }

    include_snapshot.then(|| snapshot_from_state(&mut guard))
}

pub(super) fn apply_planning_progress(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    update: &DeleteDiscoveryProgress,
    include_snapshot: bool,
) -> Option<TransferQueueSnapshot> {
    let mut guard = inner.state.lock().ok()?;

    let snapshot = if let Some(queued) = guard.queued_job_mut(job_id) {
        let snapshot = &mut queued.request.snapshot;
        snapshot.status = TransferJobStatus::Running;
        snapshot.phase = TransferJobPhase::Planning;
        snapshot
    } else {
        let active = guard.active_job_mut(job_id)?;
        &mut active.snapshot
    };

    snapshot.current_path = update.current_path.clone();
    snapshot.work.files_total = Some(update.discovered_items);
    snapshot.work.files_completed = 0;
    snapshot.work.bytes_total = Some(update.discovered_bytes);
    snapshot.work.bytes_completed = 0;

    include_snapshot.then(|| snapshot_from_state(&mut guard))
}

pub(super) fn mark_queued_job_finished(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    status: TransferJobStatus,
    event_emitter: &TransferEventEmitter,
) -> Option<TransferJobRequest> {
    let (request, snapshot) = {
        let mut guard = inner.state.lock().ok()?;
        let mut queued = guard.remove_queued_job(job_id)?;
        queued.request.snapshot.status = status;
        queued.request.snapshot.phase = TransferJobPhase::Finalizing;
        guard.push_completed_job(queued.request.snapshot.clone());
        let snapshot = snapshot_from_state(&mut guard);
        (queued.request, snapshot)
    };
    event_emitter.emit_snapshot(&snapshot);
    Some(request)
}

pub(super) fn mark_job_finished(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    outcome: &TransferOperationOutcome,
    event_emitter: &TransferEventEmitter,
) {
    let status = outcome.terminal_status;
    let destination = outcome.destination();
    let snapshot = {
        let mut guard = match inner.state.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(mut active) = guard.remove_active_job(job_id) else {
            return;
        };

        if status == TransferJobStatus::Completed {
            if let Some(runtime) = active.runtime.as_mut() {
                runtime.finalize_success(&mut active.snapshot);
            }
            active.snapshot.work.roots_completed = active.snapshot.work.roots_total;
        }

        active.snapshot.status = status;
        active.snapshot.phase = TransferJobPhase::Finalizing;
        active.snapshot.destination = destination;
        guard.push_completed_job(active.snapshot);
        snapshot_from_state(&mut guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}
