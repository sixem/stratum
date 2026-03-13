// Public handle methods and queue-control operations for the transfer manager.
use super::control::{TransferJobControlHandle, TRANSFER_CANCELLED_MESSAGE};
use super::manager_events::build_event_emitter;
use super::manager_run::start_worker;
use super::manager_state::{
    build_initial_snapshot, describe_copy_job, describe_delete_job, describe_transfer_job,
    describe_trash_job, describe_conversion_job, snapshot_from_state, TransferJobRequest,
    TransferManagerInner,
    TransferManagerState, TransferOperation, TransferOperationResult,
    COMPLETED_JOB_HISTORY_LIMIT,
};
use super::TransferManagerHandle;
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::types::{
    TransferJobPhase, TransferJobStatus, TransferQueueSnapshot,
};
use crate::domain::media::conversion_jobs;
use std::sync::atomic::AtomicU64;
use std::sync::{mpsc, Arc, Condvar, Mutex};

impl TransferManagerHandle {
    pub fn init() -> Self {
        let inner = Arc::new(TransferManagerInner {
            state: Mutex::new(TransferManagerState::default()),
            queue_signal: Condvar::new(),
            next_job_id: AtomicU64::new(1),
        });
        start_worker(Arc::clone(&inner));
        Self { inner }
    }

    pub fn copy_entries(
        &self,
        window: tauri::Window,
        paths: Vec<String>,
        destination: String,
        options: Option<fs::CopyOptions>,
        transfer_id: Option<String>,
    ) -> Result<fs::CopyReport, String> {
        let snapshot = build_initial_snapshot(
            &self.inner.next_job_id,
            transfer_id.as_deref(),
            paths.len(),
            describe_copy_job(),
        );
        let event_emitter = build_event_emitter(window, transfer_id);
        let (completion_tx, completion_rx) = mpsc::channel();
        self.enqueue(TransferJobRequest {
            snapshot,
            event_emitter,
            operation: TransferOperation::Copy {
                paths,
                destination,
                options,
            },
            completion_tx,
            control: TransferJobControlHandle::new(),
        })?;

        match completion_rx
            .recv()
            .map_err(|_| "transfer manager unavailable".to_string())??
        {
            TransferOperationResult::Copy(report) => Ok(report),
            _ => Err("transfer manager returned the wrong job result".to_string()),
        }
    }

    pub fn transfer_entries(
        &self,
        window: tauri::Window,
        paths: Vec<String>,
        destination: String,
        options: Option<fs::TransferOptions>,
        transfer_id: Option<String>,
    ) -> Result<fs::TransferReport, String> {
        let snapshot = build_initial_snapshot(
            &self.inner.next_job_id,
            transfer_id.as_deref(),
            paths.len(),
            describe_transfer_job(options.as_ref()),
        );
        let event_emitter = build_event_emitter(window, transfer_id);
        let (completion_tx, completion_rx) = mpsc::channel();
        self.enqueue(TransferJobRequest {
            snapshot,
            event_emitter,
            operation: TransferOperation::Transfer {
                paths,
                destination,
                options,
            },
            completion_tx,
            control: TransferJobControlHandle::new(),
        })?;

        match completion_rx
            .recv()
            .map_err(|_| "transfer manager unavailable".to_string())??
        {
            TransferOperationResult::Transfer(report) => Ok(report),
            _ => Err("transfer manager returned the wrong job result".to_string()),
        }
    }

    pub fn delete_entries(
        &self,
        window: tauri::Window,
        paths: Vec<String>,
        transfer_id: Option<String>,
    ) -> Result<fs::DeleteReport, String> {
        let snapshot = build_initial_snapshot(
            &self.inner.next_job_id,
            transfer_id.as_deref(),
            paths.len(),
            describe_delete_job(),
        );
        let event_emitter = build_event_emitter(window, transfer_id);
        let (completion_tx, completion_rx) = mpsc::channel();
        self.enqueue(TransferJobRequest {
            snapshot,
            event_emitter,
            operation: TransferOperation::Delete { paths },
            completion_tx,
            control: TransferJobControlHandle::new(),
        })?;

        match completion_rx
            .recv()
            .map_err(|_| "transfer manager unavailable".to_string())??
        {
            TransferOperationResult::Delete(report) => Ok(report),
            _ => Err("transfer manager returned the wrong job result".to_string()),
        }
    }

    pub fn trash_entries(
        &self,
        window: tauri::Window,
        paths: Vec<String>,
        transfer_id: Option<String>,
    ) -> Result<fs::TrashReport, String> {
        let snapshot = build_initial_snapshot(
            &self.inner.next_job_id,
            transfer_id.as_deref(),
            paths.len(),
            describe_trash_job(),
        );
        let event_emitter = build_event_emitter(window, transfer_id);
        let (completion_tx, completion_rx) = mpsc::channel();
        self.enqueue(TransferJobRequest {
            snapshot,
            event_emitter,
            operation: TransferOperation::Trash { paths },
            completion_tx,
            control: TransferJobControlHandle::new(),
        })?;

        match completion_rx
            .recv()
            .map_err(|_| "transfer manager unavailable".to_string())??
        {
            TransferOperationResult::Trash(report) => Ok(report),
            _ => Err("transfer manager returned the wrong job result".to_string()),
        }
    }

    pub fn convert_media_entries(
        &self,
        window: tauri::Window,
        items: Vec<conversion_jobs::ConversionJobItem>,
        transfer_id: Option<String>,
    ) -> Result<conversion_jobs::ConversionReport, String> {
        let snapshot = build_initial_snapshot(
            &self.inner.next_job_id,
            transfer_id.as_deref(),
            items.len(),
            describe_conversion_job(),
        );
        let event_emitter = build_event_emitter(window, transfer_id);
        let (completion_tx, completion_rx) = mpsc::channel();
        self.enqueue(TransferJobRequest {
            snapshot,
            event_emitter,
            operation: TransferOperation::Conversion { items },
            completion_tx,
            control: TransferJobControlHandle::new(),
        })?;

        match completion_rx
            .recv()
            .map_err(|_| "transfer manager unavailable".to_string())??
        {
            TransferOperationResult::Conversion(report) => Ok(report),
            _ => Err("transfer manager returned the wrong job result".to_string()),
        }
    }

    pub fn snapshot(&self) -> TransferQueueSnapshot {
        let Ok(guard) = self.inner.state.lock() else {
            return TransferQueueSnapshot::default();
        };
        snapshot_from_state(&guard)
    }

    pub fn pause_job(&self, job_id: &str) -> Result<bool, String> {
        let (event_emitter, snapshot) = {
            let mut guard = self
                .inner
                .state
                .lock()
                .map_err(|_| "transfer manager state unavailable".to_string())?;
            let Some(active) = guard.active_job.as_mut() else {
                return Ok(false);
            };
            if active.snapshot.id != job_id {
                return Ok(false);
            }
            let changed = active.control.pause()?;
            if !changed {
                return Ok(false);
            }
            active.snapshot.status = TransferJobStatus::Paused;
            let event_emitter = active.event_emitter.clone();
            let snapshot = snapshot_from_state(&guard);
            (event_emitter, snapshot)
        };
        event_emitter.emit_snapshot(&snapshot);
        Ok(true)
    }

    pub fn resume_job(&self, job_id: &str) -> Result<bool, String> {
        let (event_emitter, snapshot) = {
            let mut guard = self
                .inner
                .state
                .lock()
                .map_err(|_| "transfer manager state unavailable".to_string())?;
            let Some(active) = guard.active_job.as_mut() else {
                return Ok(false);
            };
            if active.snapshot.id != job_id {
                return Ok(false);
            }
            let changed = active.control.resume()?;
            if !changed {
                return Ok(false);
            }
            active.snapshot.status = TransferJobStatus::Running;
            let event_emitter = active.event_emitter.clone();
            let snapshot = snapshot_from_state(&guard);
            (event_emitter, snapshot)
        };
        event_emitter.emit_snapshot(&snapshot);
        Ok(true)
    }

    pub fn cancel_job(&self, job_id: &str) -> Result<bool, String> {
        let queued_index = {
            let guard = self
                .inner
                .state
                .lock()
                .map_err(|_| "transfer manager state unavailable".to_string())?;
            guard
                .queued_jobs
                .iter()
                .position(|job| job.snapshot.id == job_id)
        };

        if let Some(index) = queued_index {
            let (request, snapshot) = {
                let mut guard = self
                    .inner
                    .state
                    .lock()
                    .map_err(|_| "transfer manager state unavailable".to_string())?;
                let Some(request) = guard.queued_jobs.remove(index) else {
                    return Ok(false);
                };
                let mut cancelled = request.snapshot.clone();
                cancelled.status = TransferJobStatus::Cancelled;
                cancelled.phase = TransferJobPhase::Finalizing;
                guard.completed_jobs.push_back(cancelled);
                while guard.completed_jobs.len() > COMPLETED_JOB_HISTORY_LIMIT {
                    guard.completed_jobs.pop_front();
                }
                let snapshot = snapshot_from_state(&guard);
                (request, snapshot)
            };
            let _ = request
                .completion_tx
                .send(Err(TRANSFER_CANCELLED_MESSAGE.to_string()));
            request.event_emitter.emit_snapshot(&snapshot);
            return Ok(true);
        }

        let active_cancelled = {
            let mut guard = self
                .inner
                .state
                .lock()
                .map_err(|_| "transfer manager state unavailable".to_string())?;
            let Some(active) = guard.active_job.as_mut() else {
                return Ok(false);
            };
            if active.snapshot.id != job_id {
                return Ok(false);
            }
            active.control.cancel()?
        };

        Ok(active_cancelled)
    }

    fn enqueue(&self, job: TransferJobRequest) -> Result<(), String> {
        let event_emitter = job.event_emitter.clone();
        let snapshot = {
            let mut guard = self
                .inner
                .state
                .lock()
                .map_err(|_| "transfer manager state unavailable".to_string())?;
            guard.queued_jobs.push_back(job);
            snapshot_from_state(&guard)
        };

        event_emitter.emit_snapshot(&snapshot);
        self.inner.queue_signal.notify_one();
        Ok(())
    }
}
