// Public handle methods and queue-control operations for the transfer manager.
use super::control::{TransferJobControlHandle, TRANSFER_CANCELLED_MESSAGE};
use super::job_paths::TransferJobPaths;
use super::manager_events::build_event_emitter;
use super::manager_run::start_workers;
use super::manager_state::{
    build_initial_snapshot, describe_conversion_job, describe_copy_job, describe_delete_job,
    describe_transfer_job, describe_trash_job, snapshot_from_state, QueuedTransferJobState,
    QueuedTransferPlanningState, TransferJobRequest, TransferManagerInner, TransferManagerState,
    TransferOperation, TransferOperationResult,
};
use super::TransferManagerHandle;
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::types::{
    TransferJobPhase, TransferJobStatus, TransferQueueSnapshot,
};
use crate::domain::media::conversion_jobs;
use std::sync::atomic::AtomicU64;
use std::sync::{mpsc, Arc, Condvar, Mutex};

#[cfg(test)]
#[path = "queue_tests.rs"]
mod queue_tests;

impl TransferManagerHandle {
    #[cfg(test)]
    pub fn init() -> Self {
        Self::with_events(Default::default())
    }

    pub(crate) fn with_events(events: crate::services::operation_events::OperationEvents) -> Self {
        let inner = Arc::new(TransferManagerInner {
            events,
            state: Mutex::new(TransferManagerState::default()),
            queue_signal: Condvar::new(),
            next_job_id: AtomicU64::new(1),
        });
        start_workers(Arc::clone(&inner));
        Self { inner }
    }

    #[cfg(windows)]
    pub(crate) fn remote_delete(
        &self,
        window: tauri::Window,
        job: crate::services::remotes::operations::RemoteDelete,
        transfer_id: Option<String>,
    ) -> Result<fs::DeleteReport, String> {
        let snapshot = build_initial_snapshot(
            &self.inner.next_job_id,
            transfer_id.as_deref(),
            job.entries.len(),
            describe_delete_job(),
        );
        let event_emitter = build_event_emitter(window, transfer_id);
        let (completion_tx, completion_rx) = mpsc::channel();
        self.enqueue(TransferJobRequest {
            snapshot,
            event_emitter,
            operation: TransferOperation::RemoteDelete(job),
            completion_tx,
            control: TransferJobControlHandle::new(),
        })?;
        match completion_rx
            .recv()
            .map_err(|_| "transfer manager unavailable".to_string())??
        {
            TransferOperationResult::Delete(report) => Ok(report),
            _ => Err("transfer manager returned the wrong job result".into()),
        }
    }

    #[cfg(all(test, windows))]
    pub(crate) fn remote_delete_fixture(
        &self,
        job: crate::services::remotes::operations::RemoteDelete,
    ) -> mpsc::Receiver<Result<fs::DeleteReport, String>> {
        let snapshot = build_initial_snapshot(
            &self.inner.next_job_id,
            Some("fixture-delete"),
            job.entries.len(),
            describe_delete_job(),
        );
        let (completion_tx, completion_rx) = mpsc::channel();
        self.enqueue(TransferJobRequest {
            snapshot,
            event_emitter: super::manager_events::TransferEventEmitter::silent(),
            operation: TransferOperation::RemoteDelete(job),
            completion_tx,
            control: TransferJobControlHandle::new(),
        })
        .unwrap();
        let (result_tx, result_rx) = mpsc::channel();
        std::thread::spawn(move || {
            let result = match completion_rx.recv() {
                Ok(Ok(TransferOperationResult::Delete(report))) => Ok(report),
                Ok(Err(error)) => Err(error),
                _ => Err("transfer manager returned the wrong job result".into()),
            };
            let _ = result_tx.send(result);
        });
        result_rx
    }

    #[cfg(windows)]
    pub(crate) fn remote_batch(
        &self,
        window: tauri::Window,
        batch: crate::services::remotes::transfer::TransferBatch,
        transfer_id: Option<String>,
    ) -> Result<crate::services::remotes::transfer::BatchResult, String> {
        let first = batch.items.first().ok_or("Select at least one item.")?;
        let snapshot = build_initial_snapshot(
            &self.inner.next_job_id,
            transfer_id.as_deref(),
            batch.items.len(),
            super::manager_state::describe_remote_job(first.moving),
        );
        let event_emitter = build_event_emitter(window, transfer_id);
        let (completion_tx, completion_rx) = mpsc::channel();
        self.enqueue(TransferJobRequest {
            snapshot,
            event_emitter,
            operation: TransferOperation::RemoteBatch(batch),
            completion_tx,
            control: TransferJobControlHandle::new(),
        })?;
        match completion_rx
            .recv()
            .map_err(|_| "transfer manager unavailable".to_string())??
        {
            TransferOperationResult::RemoteBatch(report) => Ok(report),
            _ => Err("transfer manager returned the wrong job result".into()),
        }
    }

    #[cfg(windows)]
    pub(crate) fn remote_file(
        &self,
        window: tauri::Window,
        job: crate::services::remotes::transfer::Transfer,
        transfer_id: Option<String>,
    ) -> Result<crate::services::remotes::transfer::BatchResult, String> {
        let total = match &job.direction {
            crate::services::remotes::transfer::Direction::Rename { entries, .. } => entries.len(),
            _ => 1,
        };
        let snapshot = build_initial_snapshot(
            &self.inner.next_job_id,
            transfer_id.as_deref(),
            total,
            super::manager_state::describe_remote_job(job.moving),
        );
        let event_emitter = build_event_emitter(window, transfer_id);
        let (completion_tx, completion_rx) = mpsc::channel();
        self.enqueue(TransferJobRequest {
            snapshot,
            event_emitter,
            operation: TransferOperation::Remote(job),
            completion_tx,
            control: TransferJobControlHandle::new(),
        })?;
        match completion_rx
            .recv()
            .map_err(|_| "transfer manager unavailable".to_string())??
        {
            TransferOperationResult::RemoteBatch(report) => Ok(report),
            _ => Err("transfer manager returned the wrong job result".into()),
        }
    }

    #[cfg(all(test, windows))]
    pub(crate) fn remote_move_fixture(
        &self,
        job: crate::services::remotes::transfer::Transfer,
        id: &str,
    ) -> mpsc::Receiver<Result<crate::services::remotes::transfer::BatchResult, String>> {
        let total = match &job.direction {
            crate::services::remotes::transfer::Direction::Rename { entries, .. } => entries.len(),
            _ => panic!("Expected same-host move"),
        };
        self.remote_fixture_request(TransferOperation::Remote(job), id, total, true)
    }

    #[cfg(all(test, windows))]
    pub(crate) fn remote_batch_fixture(
        &self,
        batch: crate::services::remotes::transfer::TransferBatch,
        id: &str,
    ) -> mpsc::Receiver<Result<crate::services::remotes::transfer::BatchResult, String>> {
        let total = batch.items.len();
        let moving = batch.items[0].moving;
        self.remote_fixture_request(TransferOperation::RemoteBatch(batch), id, total, moving)
    }

    #[cfg(all(test, windows))]
    fn remote_fixture_request(
        &self,
        operation: TransferOperation,
        id: &str,
        total: usize,
        moving: bool,
    ) -> mpsc::Receiver<Result<crate::services::remotes::transfer::BatchResult, String>> {
        let snapshot = build_initial_snapshot(
            &self.inner.next_job_id,
            Some(id),
            total,
            super::manager_state::describe_remote_job(moving),
        );
        let (completion_tx, completion_rx) = mpsc::channel();
        self.enqueue(TransferJobRequest {
            snapshot,
            event_emitter: super::manager_events::TransferEventEmitter::silent(),
            operation,
            completion_tx,
            control: TransferJobControlHandle::new(),
        })
        .unwrap();
        let (result_tx, result_rx) = mpsc::channel();
        std::thread::spawn(move || {
            let result = match completion_rx.recv() {
                Ok(Ok(TransferOperationResult::RemoteBatch(report))) => Ok(report),
                Ok(Err(error)) => Err(error),
                _ => Err("transfer manager returned the wrong job result".into()),
            };
            let _ = result_tx.send(result);
        });
        result_rx
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
        #[cfg(windows)] drop_stage: Option<crate::platform::windows::dragdrop::DropStage>,
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
                #[cfg(windows)]
                drop_stage: drop_stage.map(Arc::new),
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
        let Ok(mut guard) = self.inner.state.lock() else {
            return TransferQueueSnapshot::default();
        };
        snapshot_from_state(&mut guard)
    }

    pub fn pause_job(&self, job_id: &str) -> Result<bool, String> {
        let (event_emitter, snapshot) = {
            let mut guard = self
                .inner
                .state
                .lock()
                .map_err(|_| "transfer manager state unavailable".to_string())?;
            if guard.shutdown_ticket.is_some() {
                return Ok(false);
            }
            let Some(active) = guard.active_job_mut(job_id) else {
                return Ok(false);
            };
            let changed = active.control.pause()?;
            if !changed {
                return Ok(false);
            }
            active.snapshot.status = TransferJobStatus::Paused;
            let event_emitter = active.event_emitter.clone();
            let snapshot = snapshot_from_state(&mut guard);
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
            let Some(active) = guard.active_job_mut(job_id) else {
                return Ok(false);
            };
            let changed = active.control.resume()?;
            if !changed {
                return Ok(false);
            }
            active.snapshot.status = TransferJobStatus::Running;
            let event_emitter = active.event_emitter.clone();
            let snapshot = snapshot_from_state(&mut guard);
            (event_emitter, snapshot)
        };
        event_emitter.emit_snapshot(&snapshot);
        Ok(true)
    }

    pub fn cancel_job(&self, job_id: &str) -> Result<bool, String> {
        let (request, snapshot) = {
            let mut guard = self
                .inner
                .state
                .lock()
                .map_err(|_| "transfer manager state unavailable".to_string())?;
            if let Some(active) = guard.active_job_mut(job_id) {
                return active.control.cancel();
            }
            let Some(queued) = guard.remove_queued_job(job_id) else {
                return Ok(false);
            };
            guard.releasing_jobs += 1;
            let request = queued.request;
            let _ = request.control.cancel();
            let mut cancelled = request.snapshot.clone();
            cancelled.status = TransferJobStatus::Cancelled;
            cancelled.phase = TransferJobPhase::Finalizing;
            guard.push_completed_job(cancelled);
            (request, snapshot_from_state(&mut guard))
        };
        request.event_emitter.emit_snapshot(&snapshot);
        super::manager_events::finish_unstarted(
            &self.inner.events,
            job_id,
            &request.operation,
            TransferJobStatus::Cancelled,
        );
        self.inner.queue_signal.notify_all();
        let _ = request
            .completion_tx
            .send(Err(TRANSFER_CANCELLED_MESSAGE.to_string()));
        drop(request);
        if let Ok(mut guard) = self.inner.state.lock() {
            guard.releasing_jobs -= 1;
        }
        self.inner.queue_signal.notify_all();
        Ok(true)
    }

    fn enqueue(&self, job: TransferJobRequest) -> Result<(), String> {
        let paths = TransferJobPaths::from_operation(&job.operation);
        let event_emitter = job.event_emitter.clone();
        let snapshot = {
            let reject = |message: &str| {
                super::manager_events::finish_unstarted(
                    &self.inner.events,
                    &job.snapshot.id,
                    &job.operation,
                    TransferJobStatus::Failed,
                );
                Err(message.to_string())
            };
            let mut guard = match self.inner.state.lock() {
                Ok(guard) => guard,
                Err(_) => return reject("transfer manager state unavailable"),
            };
            if guard.shutdown_ticket.is_some() {
                drop(guard);
                return reject("Stratum is closing and cannot start a new job.");
            }
            if guard.has_pending_job(&job.snapshot.id) {
                drop(guard);
                return reject("A transfer with this ID is already queued or running");
            }
            guard.queued_jobs.push_back(QueuedTransferJobState {
                request: job,
                planning_state: QueuedTransferPlanningState::Pending,
                paths,
            });
            snapshot_from_state(&mut guard)
        };

        event_emitter.emit_snapshot(&snapshot);
        self.inner.queue_signal.notify_all();
        Ok(())
    }
}
