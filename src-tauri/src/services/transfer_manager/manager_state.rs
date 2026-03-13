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
use std::sync::{mpsc, Condvar, Mutex};

pub(super) const COMPLETED_JOB_HISTORY_LIMIT: usize = 20;

pub(super) struct TransferManagerInner {
    pub(super) state: Mutex<TransferManagerState>,
    pub(super) queue_signal: Condvar,
    pub(super) next_job_id: AtomicU64,
}

#[derive(Default)]
pub(super) struct TransferManagerState {
    pub(super) active_job: Option<ActiveTransferJobState>,
    pub(super) queued_jobs: VecDeque<TransferJobRequest>,
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
        if self.progress_kind != Some(TransferProgressKind::Files) {
            return;
        }

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

    pub(super) fn finalize_success(&mut self, snapshot: &mut TransferJobSnapshot) {
        if self.progress_kind != Some(TransferProgressKind::Files) {
            return;
        }
        self.commit_current_file(snapshot);
        snapshot.work.files_completed = snapshot.work.files_total.unwrap_or(0);
        snapshot.work.bytes_completed = snapshot.work.bytes_total.unwrap_or(0);
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
            .map(|job| job.snapshot.clone())
            .collect(),
        completed_jobs: state.completed_jobs.iter().cloned().collect(),
    }
}
