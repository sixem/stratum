// Shared queue state, job descriptors, and snapshot helpers for the transfer manager.
use super::control::TransferJobControlHandle;
use super::job_paths::TransferJobPaths;
use super::manager_events::TransferEventEmitter;
use super::progress_batch::TransferProgressBatch;
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::destination::TransferDestination;
use crate::domain::filesystem::transfer::job_plan::{PlannedTransferJob, TransferProgressKind};
use crate::domain::filesystem::transfer::types::{
    TransferJobCapabilities, TransferJobKind, TransferJobPhase, TransferJobSnapshot,
    TransferJobStatus, TransferQueueSnapshot, TransferWorkEstimate,
};
use crate::domain::media::conversion_jobs;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(windows)]
use std::sync::Arc;
use std::sync::{mpsc, Condvar, Mutex};

#[cfg(test)]
#[path = "manager_state/progress_tests.rs"]
mod progress_tests;

pub(super) const COMPLETED_JOB_HISTORY_LIMIT: usize = 20;

pub(super) struct TransferManagerInner {
    pub(super) state: Mutex<TransferManagerState>,
    pub(super) queue_signal: Condvar,
    pub(super) next_job_id: AtomicU64,
}

#[derive(Default)]
pub(super) struct TransferManagerState {
    pub(super) active_jobs: Vec<ActiveTransferJobState>,
    // Arrival order keeps overlapping operations from leapfrogging each other.
    pub(super) queued_jobs: VecDeque<QueuedTransferJobState>,
    pub(super) completed_jobs: VecDeque<TransferJobSnapshot>,
    // A cancelled queue entry can disappear before its planner or staging
    // cleanup finishes. Shutdown also waits for those owners.
    pub(super) planning_jobs: usize,
    pub(super) releasing_jobs: usize,
    pub(super) shutdown_ticket: Option<u64>,
    pub(super) next_shutdown_ticket: u64,
    pub(super) process_exit_requested: bool,
    snapshot_revision: u64,
}

pub(super) struct ActiveTransferJobState {
    pub(super) snapshot: TransferJobSnapshot,
    pub(super) runtime: Option<ActiveTransferRuntimeProgress>,
    pub(super) control: TransferJobControlHandle,
    pub(super) event_emitter: TransferEventEmitter,
    paths: TransferJobPaths,
}

#[derive(Clone, Default)]
pub(super) struct ActiveTransferRuntimeProgress {
    pub(super) progress_kind: Option<TransferProgressKind>,
    pub(super) committed_files: usize,
    pub(super) committed_bytes: u64,
}

pub(super) struct QueuedTransferJobState {
    pub(super) request: TransferJobRequest,
    pub(super) planning_state: QueuedTransferPlanningState,
    pub(super) paths: TransferJobPaths,
}

pub(super) enum QueuedTransferPlanningState {
    Pending,
    Planning,
    Ready(PlannedTransferJob),
}

#[derive(Clone)]
pub(super) enum TransferOperation {
    Copy {
        paths: Vec<String>,
        destination: String,
        options: Option<fs::CopyOptions>,
    },
    Transfer {
        paths: Vec<String>,
        destination: String,
        options: Option<fs::TransferOptions>,
        // A cancelled planning job may report completion before its worker
        // unwinds. The worker's cloned request keeps the sources alive.
        #[cfg(windows)]
        drop_stage: Option<Arc<crate::platform::windows::dragdrop::DropStage>>,
    },
    Delete {
        paths: Vec<String>,
    },
    Trash {
        paths: Vec<String>,
    },
    Conversion {
        items: Vec<conversion_jobs::ConversionJobItem>,
    },
}

pub(super) enum TransferOperationResult {
    Copy(fs::CopyReport),
    Transfer(fs::TransferReport),
    Delete(fs::DeleteReport),
    Trash(fs::TrashReport),
    Conversion(conversion_jobs::ConversionReport),
}

pub(super) struct TransferOperationOutcome {
    pub(super) result: Result<TransferOperationResult, String>,
    pub(super) terminal_status: TransferJobStatus,
}

impl TransferOperationOutcome {
    pub(super) fn destination(&self) -> Option<TransferDestination> {
        if self.terminal_status != TransferJobStatus::Completed {
            return None;
        }
        match self.result.as_ref().ok()? {
            TransferOperationResult::Copy(report) => report.destination.target(),
            TransferOperationResult::Transfer(report) => report.destination.target(),
            TransferOperationResult::Conversion(report) => report.destination.target(),
            _ => None,
        }
    }
}

#[derive(Clone)]
pub(super) struct TransferJobRequest {
    pub(super) snapshot: TransferJobSnapshot,
    pub(super) event_emitter: TransferEventEmitter,
    pub(super) operation: TransferOperation,
    pub(super) completion_tx: mpsc::Sender<Result<TransferOperationResult, String>>,
    pub(super) control: TransferJobControlHandle,
}

#[derive(Clone, Copy)]
pub(super) struct TransferJobDescriptor {
    pub(super) kind: TransferJobKind,
    pub(super) capabilities: TransferJobCapabilities,
}

impl QueuedTransferPlanningState {
    pub(super) fn is_pending(&self) -> bool {
        matches!(self, Self::Pending)
    }

    pub(super) fn is_ready(&self) -> bool {
        matches!(self, Self::Ready(_))
    }
}

impl QueuedTransferJobState {
    pub(super) fn job_id(&self) -> &str {
        &self.request.snapshot.id
    }
}

impl TransferManagerState {
    // Planning reads manifests from disk. Wait for older jobs that may create
    // or change those paths so estimates and delete plans see committed work.
    pub(super) fn claim_next_planning_job(&mut self) -> Option<TransferJobRequest> {
        let index = self.next_available_job(QueuedTransferPlanningState::is_pending)?;
        let queued = &mut self.queued_jobs[index];
        queued.planning_state = QueuedTransferPlanningState::Planning;
        self.planning_jobs += 1;
        Some(queued.request.clone())
    }

    // Claim the filesystem paths and make the job active under the same lock.
    // Other workers and cancel commands can always see who owns the paths.
    pub(super) fn activate_next_ready_job(
        &mut self,
    ) -> Option<(TransferJobRequest, PlannedTransferJob)> {
        let index = self.next_available_job(QueuedTransferPlanningState::is_ready)?;
        let QueuedTransferJobState {
            request,
            planning_state: QueuedTransferPlanningState::Ready(plan),
            paths,
        } = self.queued_jobs.remove(index)?
        else {
            return None;
        };
        let mut snapshot = request.snapshot.clone();
        snapshot.status = TransferJobStatus::Running;
        snapshot.phase = TransferJobPhase::Executing;
        snapshot.current_path = None;
        snapshot.work = plan.work.clone();
        self.active_jobs.push(ActiveTransferJobState {
            snapshot,
            runtime: Some(ActiveTransferRuntimeProgress::from_plan(&plan)),
            control: request.control.clone(),
            event_emitter: request.event_emitter.clone(),
            paths,
        });
        Some((request, plan))
    }

    fn next_available_job(
        &self,
        eligible: impl Fn(&QueuedTransferPlanningState) -> bool,
    ) -> Option<usize> {
        self.queued_jobs
            .iter()
            .enumerate()
            .find(|(index, job)| {
                eligible(&job.planning_state)
                    && !self
                        .active_jobs
                        .iter()
                        .any(|active| active.paths.overlaps(&job.paths))
                    && !self
                        .queued_jobs
                        .iter()
                        .take(*index)
                        .any(|earlier| earlier.paths.overlaps(&job.paths))
            })
            .map(|(index, _)| index)
    }

    pub(super) fn has_pending_job(&self, job_id: &str) -> bool {
        self.active_jobs.iter().any(|job| job.snapshot.id == job_id)
            || self.queued_jobs.iter().any(|job| job.job_id() == job_id)
    }

    pub(super) fn active_job_mut(&mut self, job_id: &str) -> Option<&mut ActiveTransferJobState> {
        self.active_jobs
            .iter_mut()
            .find(|job| job.snapshot.id == job_id)
    }

    pub(super) fn remove_active_job(&mut self, job_id: &str) -> Option<ActiveTransferJobState> {
        let index = self
            .active_jobs
            .iter()
            .position(|job| job.snapshot.id == job_id)?;
        Some(self.active_jobs.remove(index))
    }

    pub(super) fn queued_job_mut(&mut self, job_id: &str) -> Option<&mut QueuedTransferJobState> {
        self.queued_jobs
            .iter_mut()
            .find(|job| job.job_id() == job_id)
    }

    pub(super) fn remove_queued_job(&mut self, job_id: &str) -> Option<QueuedTransferJobState> {
        let index = self
            .queued_jobs
            .iter()
            .position(|job| job.job_id() == job_id)?;
        self.queued_jobs.remove(index)
    }

    pub(super) fn push_completed_job(&mut self, snapshot: TransferJobSnapshot) {
        self.completed_jobs.push_back(snapshot);
        while self.completed_jobs.len() > COMPLETED_JOB_HISTORY_LIMIT {
            self.completed_jobs.pop_front();
        }
    }
}

impl ActiveTransferRuntimeProgress {
    pub(super) fn from_plan(plan: &PlannedTransferJob) -> Self {
        Self {
            progress_kind: Some(plan.progress_kind),
            ..Self::default()
        }
    }

    pub(super) fn update_snapshot(
        &mut self,
        snapshot: &mut TransferJobSnapshot,
        batch: &TransferProgressBatch,
    ) {
        match self.progress_kind {
            Some(TransferProgressKind::Files) => {
                self.committed_files = self.committed_files.saturating_add(batch.file_work.files);
                self.committed_bytes = self.committed_bytes.saturating_add(batch.file_work.bytes);
                snapshot.work.files_completed = self.committed_files;
                snapshot.work.bytes_completed =
                    self.committed_bytes.saturating_add(batch.in_flight_bytes);
                // A folder may grow between planning and execution. Count new
                // work as we see it so the estimate can catch up.
                if let Some(total) = snapshot.work.files_total.as_mut() {
                    *total = (*total).max(self.committed_files);
                }
                if let Some(total) = snapshot.work.bytes_total.as_mut() {
                    *total = (*total).max(snapshot.work.bytes_completed);
                }
            }
            Some(TransferProgressKind::Items) => {
                snapshot.work.files_total = Some(batch.latest.total);
                snapshot.work.files_completed = batch.latest.processed;
            }
            _ => {}
        }
    }

    pub(super) fn finalize_success(&mut self, snapshot: &mut TransferJobSnapshot) {
        match self.progress_kind {
            Some(TransferProgressKind::Files) => {
                snapshot.work.files_completed = snapshot.work.files_total.unwrap_or(0);
                snapshot.work.bytes_completed = snapshot.work.bytes_total.unwrap_or(0);
            }
            Some(TransferProgressKind::Items) => {
                snapshot.work.files_completed = snapshot.work.files_total.unwrap_or(0);
            }
            _ => {}
        }
    }
}

pub(super) fn build_initial_snapshot(
    next_job_id: &AtomicU64,
    requested_id: Option<&str>,
    roots_total: usize,
    descriptor: TransferJobDescriptor,
) -> TransferJobSnapshot {
    let id = requested_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            let next = next_job_id.fetch_add(1, Ordering::Relaxed);
            format!("transfer-manager-{next}")
        });

    TransferJobSnapshot {
        id,
        kind: descriptor.kind,
        status: TransferJobStatus::Queued,
        phase: TransferJobPhase::Planning,
        capabilities: descriptor.capabilities,
        current_path: None,
        destination: None,
        work: TransferWorkEstimate {
            roots_total,
            roots_completed: 0,
            files_total: None,
            files_completed: 0,
            bytes_total: None,
            bytes_completed: 0,
        },
    }
}

fn transfer_job_capabilities() -> TransferJobCapabilities {
    TransferJobCapabilities {
        can_pause: true,
        can_cancel: true,
    }
}

fn cancel_only_job_capabilities() -> TransferJobCapabilities {
    TransferJobCapabilities {
        can_pause: false,
        can_cancel: true,
    }
}

pub(super) fn describe_copy_job() -> TransferJobDescriptor {
    TransferJobDescriptor {
        kind: TransferJobKind::Copy,
        capabilities: transfer_job_capabilities(),
    }
}

pub(super) fn describe_transfer_job(
    options: Option<&fs::TransferOptions>,
) -> TransferJobDescriptor {
    let kind = match options
        .and_then(|value| value.mode)
        .unwrap_or(fs::TransferMode::Auto)
    {
        fs::TransferMode::Copy => TransferJobKind::Copy,
        fs::TransferMode::Move => TransferJobKind::Move,
        fs::TransferMode::Auto => TransferJobKind::Transfer,
    };

    TransferJobDescriptor {
        kind,
        capabilities: transfer_job_capabilities(),
    }
}

pub(super) fn describe_delete_job() -> TransferJobDescriptor {
    TransferJobDescriptor {
        kind: TransferJobKind::Delete,
        capabilities: cancel_only_job_capabilities(),
    }
}

pub(super) fn describe_trash_job() -> TransferJobDescriptor {
    TransferJobDescriptor {
        kind: TransferJobKind::Trash,
        capabilities: cancel_only_job_capabilities(),
    }
}

pub(super) fn describe_conversion_job() -> TransferJobDescriptor {
    TransferJobDescriptor {
        kind: TransferJobKind::Conversion,
        capabilities: cancel_only_job_capabilities(),
    }
}

pub(super) fn snapshot_from_state(state: &mut TransferManagerState) -> TransferQueueSnapshot {
    // Workers emit after releasing the lock. A revision lets consumers drop
    // older snapshots even when the event order differs from the state order.
    state.snapshot_revision = state.snapshot_revision.saturating_add(1);
    TransferQueueSnapshot {
        revision: state.snapshot_revision,
        active_jobs: state
            .active_jobs
            .iter()
            .map(|job| job.snapshot.clone())
            .collect(),
        queued_jobs: state
            .queued_jobs
            .iter()
            .map(|job| job.request.snapshot.clone())
            .collect(),
        completed_jobs: state.completed_jobs.iter().cloned().collect(),
    }
}

#[cfg(all(test, windows))]
mod stage_tests {
    use super::*;
    use crate::platform::windows::dragdrop::claimed_test_file;
    use std::{fs, path::Path};

    #[test]
    fn cancelling_a_queued_transfer_keeps_staged_data_alive_for_its_planner() {
        let (stage, source) = claimed_test_file();
        let queued_operation = TransferOperation::Transfer {
            paths: vec![source.clone()],
            destination: String::from(r"C:\destination"),
            options: None,
            drop_stage: Some(Arc::new(stage)),
        };
        let planning_operation = queued_operation.clone();

        // The queue can signal cancellation while a worker still holds the
        // operation it cloned to inspect source files for planning.
        drop(queued_operation);
        assert_eq!(fs::read(&source).unwrap(), b"sample");
        drop(planning_operation);
        assert!(!Path::new(&source).exists());
    }
}
