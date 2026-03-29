// Snapshot and runtime-state mutation helpers for transfer jobs.
// Keeping all queue-state writes here makes status transitions easier to reason about.
use super::manager_events::TransferEventEmitter;
use super::manager_state::{
    snapshot_from_state, ActiveTransferJobState, ActiveTransferRuntimeProgress,
    TransferJobRequest, TransferManagerInner, COMPLETED_JOB_HISTORY_LIMIT,
};
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::delete_discovery::DeleteDiscoveryProgress;
use crate::domain::filesystem::transfer::job_plan::{PlannedTransferJob, TransferProgressKind};
use crate::domain::filesystem::transfer::types::{
    TransferJobPhase, TransferJobStatus, TransferQueueSnapshot,
};
use std::sync::Arc;

pub(super) fn activate_job(inner: &Arc<TransferManagerInner>, job: &TransferJobRequest) {
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

pub(super) fn apply_job_plan(
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

pub(super) fn mark_job_executing(
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
        active.snapshot.current_path = None;
        snapshot_from_state(&guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}

pub(super) fn apply_running_progress(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    progress_kind: TransferProgressKind,
    update: &fs::TransferProgressUpdate,
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

    Some(snapshot_from_state(&guard))
}

pub(super) fn apply_planning_progress(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    update: &DeleteDiscoveryProgress,
) -> Option<TransferQueueSnapshot> {
    let mut guard = inner.state.lock().ok()?;
    let active = guard.active_job.as_mut()?;
    if active.snapshot.id != job_id {
        return None;
    }

    active.snapshot.current_path = update.current_path.clone();
    active.snapshot.work.files_total = Some(update.discovered_items);
    active.snapshot.work.files_completed = 0;
    active.snapshot.work.bytes_total = Some(update.discovered_bytes);
    active.snapshot.work.bytes_completed = 0;

    Some(snapshot_from_state(&guard))
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
        guard.completed_jobs.push_back(active.snapshot);
        while guard.completed_jobs.len() > COMPLETED_JOB_HISTORY_LIMIT {
            guard.completed_jobs.pop_front();
        }
        snapshot_from_state(&guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}
