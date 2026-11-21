// Snapshot and runtime-state mutation helpers for transfer jobs.
// Keeping all queue-state writes here makes status transitions easier to reason about.
use super::manager_events::TransferEventEmitter;
use super::manager_state::{
    snapshot_from_state, ActiveTransferJobState, ActiveTransferRuntimeProgress,
    QueuedTransferPlanningState, TransferJobRequest, TransferManagerInner,
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
        snapshot_from_state(&guard)
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
        snapshot_from_state(&guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}

pub(super) fn activate_job(
    inner: &Arc<TransferManagerInner>,
    job: &TransferJobRequest,
    plan: &PlannedTransferJob,
) {
    let snapshot = {
        let mut guard = match inner.state.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let mut snapshot = job.snapshot.clone();
        snapshot.status = TransferJobStatus::Running;
        snapshot.phase = TransferJobPhase::Executing;
        snapshot.current_path = None;
        snapshot.work = plan.work.clone();
        guard.active_job = Some(ActiveTransferJobState {
            snapshot,
            runtime: Some(ActiveTransferRuntimeProgress::from_plan(plan)),
            control: job.control.clone(),
            event_emitter: job.event_emitter.clone(),
        });
        snapshot_from_state(&guard)
    };
    job.event_emitter.emit_snapshot(&snapshot);
}

pub(super) fn apply_running_progress(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    progress_kind: TransferProgressKind,
    update: &fs::TransferProgressUpdate,
    include_snapshot: bool,
) -> Option<TransferQueueSnapshot> {
    let mut guard = inner.state.lock().ok()?;
    let active = guard.active_job.as_mut()?;
    if active.snapshot.id != job_id {
        return None;
    }

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
            active.snapshot.work.files_total = Some(update.total);
            active.snapshot.work.files_completed = update.processed;
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

    include_snapshot.then(|| snapshot_from_state(&guard))
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
        let active = guard.active_job.as_mut()?;
        if active.snapshot.id != job_id {
            return None;
        }
        &mut active.snapshot
    };

    snapshot.current_path = update.current_path.clone();
    snapshot.work.files_total = Some(update.discovered_items);
    snapshot.work.files_completed = 0;
    snapshot.work.bytes_total = Some(update.discovered_bytes);
    snapshot.work.bytes_completed = 0;

    include_snapshot.then(|| snapshot_from_state(&guard))
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
        let snapshot = snapshot_from_state(&guard);
        (queued.request, snapshot)
    };
    event_emitter.emit_snapshot(&snapshot);
    Some(request)
}

pub(super) fn mark_job_finished(
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
        guard.push_completed_job(active.snapshot);
        snapshot_from_state(&guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}
