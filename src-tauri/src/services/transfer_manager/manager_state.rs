// Shared queue state, job descriptors, and snapshot helpers for the transfer manager.
use super::control::TransferJobControlHandle;
use super::manager_events::TransferEventEmitter;
use crate::domain::filesystem as fs;
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

pub(super) const COMPLETED_JOB_HISTORY_LIMIT: usize = 20;

pub(super) struct TransferManagerInner {
    pub(super) state: Mutex<TransferManagerState>,
    pub(super) queue_signal: Condvar,
    pub(super) next_job_id: AtomicU64,
}

#[derive(Default)]
pub(super) struct TransferManagerState {
    // The single execution slot stays separate so we can keep filesystem writes serialized.
    pub(super) active_job: Option<ActiveTransferJobState>,
    // Queued jobs remain in arrival order even while their planning work happens elsewhere.
    pub(super) queued_jobs: VecDeque<QueuedTransferJobState>,
    pub(super) completed_jobs: VecDeque<TransferJobSnapshot>,
}

pub(super) struct ActiveTransferJobState {
    pub(super) snapshot: TransferJobSnapshot,
    pub(super) runtime: Option<ActiveTransferRuntimeProgress>,
    pub(super) control: TransferJobControlHandle,
    pub(super) event_emitter: TransferEventEmitter,
}

#[derive(Clone, Default)]
pub(super) struct ActiveTransferRuntimeProgress {
    pub(super) progress_kind: Option<TransferProgressKind>,
    pub(super) committed_files: usize,
    pub(super) committed_bytes: u64,
    pub(super) current_file_path: Option<String>,
    pub(super) current_file_total_bytes: Option<u64>,
    pub(super) current_file_copied_bytes: u64,
}

pub(super) struct QueuedTransferJobState {
    pub(super) request: TransferJobRequest,
    pub(super) planning_state: QueuedTransferPlanningState,
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

    pub(super) fn claim_for_planning(&mut self) -> Option<TransferJobRequest> {
        if !self.planning_state.is_pending() {
            return None;
        }

        self.planning_state = QueuedTransferPlanningState::Planning;
        Some(self.request.clone())
    }

    pub(super) fn take_ready_plan(self) -> Option<(TransferJobRequest, PlannedTransferJob)> {
        let QueuedTransferPlanningState::Ready(plan) = self.planning_state else {
            return None;
        };
        Some((self.request, plan))
    }
}

impl TransferManagerState {
    // Planning workers claim the earliest still-pending job so queue order remains stable.
    pub(super) fn claim_next_planning_job(&mut self) -> Option<TransferJobRequest> {
        self.queued_jobs
            .iter_mut()
            .find_map(QueuedTransferJobState::claim_for_planning)
    }

    // The single executor takes the earliest ready job, which lets ready work bypass
    // still-planning jobs while preserving arrival order among ready jobs themselves.
    pub(super) fn take_next_ready_job(
        &mut self,
    ) -> Option<(TransferJobRequest, PlannedTransferJob)> {
        let ready_index = self
            .queued_jobs
            .iter()
            .position(|job| job.planning_state.is_ready())?;
        let queued = self.queued_jobs.remove(ready_index)?;
        queued.take_ready_plan()
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
        update: &fs::TransferProgressUpdate,
    ) {
        match self.progress_kind {
            Some(TransferProgressKind::Files) => {
                if let Some(path) = update.current_path.as_ref() {
                    if update.current_total_bytes.is_some()
                        && self.current_file_path.as_deref() != Some(path.as_str())
                    {
                        self.commit_current_file(snapshot);
                        self.current_file_path = Some(path.clone());
                        self.current_file_total_bytes = update.current_total_bytes;
                        self.current_file_copied_bytes = update.current_bytes.unwrap_or(0);
                    }
                }

                if let Some(current_total_bytes) = update.current_total_bytes {
                    if self.current_file_total_bytes != Some(current_total_bytes) {
                        self.current_file_total_bytes = Some(current_total_bytes);
                    }
                }

                if let Some(current_bytes) = update.current_bytes {
                    self.current_file_copied_bytes = current_bytes;
                }

                if let Some(total_bytes) = self.current_file_total_bytes {
                    snapshot.work.bytes_completed = self
                        .committed_bytes
                        .saturating_add(self.current_file_copied_bytes.min(total_bytes));
                    if self.current_file_copied_bytes >= total_bytes {
                        self.commit_current_file(snapshot);
                    }
                } else {
                    snapshot.work.bytes_completed = self.committed_bytes;
                }
            }
            Some(TransferProgressKind::Items) => {
                snapshot.work.files_total = Some(update.total);
                snapshot.work.files_completed = update.processed;
            }
            _ => {}
        }
    }

    pub(super) fn finalize_success(&mut self, snapshot: &mut TransferJobSnapshot) {
        match self.progress_kind {
            Some(TransferProgressKind::Files) => {
                self.commit_current_file(snapshot);
                snapshot.work.files_completed = snapshot.work.files_total.unwrap_or(0);
                snapshot.work.bytes_completed = snapshot.work.bytes_total.unwrap_or(0);
            }
            Some(TransferProgressKind::Items) => {
                snapshot.work.files_completed = snapshot.work.files_total.unwrap_or(0);
            }
            _ => {}
        }
    }

    fn commit_current_file(&mut self, snapshot: &mut TransferJobSnapshot) {
        let Some(total_bytes) = self.current_file_total_bytes else {
            return;
        };
        self.committed_files = self.committed_files.saturating_add(1);
        self.committed_bytes = self.committed_bytes.saturating_add(total_bytes);
        snapshot.work.files_completed = self.committed_files;
        snapshot.work.bytes_completed = self.committed_bytes;
        self.current_file_path = None;
        self.current_file_total_bytes = None;
        self.current_file_copied_bytes = 0;
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

pub(super) fn snapshot_from_state(state: &TransferManagerState) -> TransferQueueSnapshot {
    TransferQueueSnapshot {
        active_job: state.active_job.as_ref().map(|job| job.snapshot.clone()),
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
