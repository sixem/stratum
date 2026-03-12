// Sequential backend file-operation queue used by filesystem commands.
// The manager owns queueing, lifecycle snapshots, and cooperative controls.
#[path = "transfer_manager/control.rs"]
mod control;

use self::control::{TransferJobControlHandle, TRANSFER_CANCELLED_MESSAGE};
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::job_plan::{
    plan_copy_job, plan_root_only_job, plan_transfer_job, PlannedTransferJob,
    TransferProgressKind,
};
use crate::domain::filesystem::transfer::types::{
    TransferJobCapabilities, TransferJobKind, TransferJobPhase, TransferJobSnapshot,
    TransferJobStatus, TransferQueueSnapshot, TransferWorkEstimate,
};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use tauri::Emitter;
use tauri::Manager;

const COMPLETED_JOB_HISTORY_LIMIT: usize = 20;

#[derive(Clone)]
pub struct TransferManagerHandle {
    inner: Arc<TransferManagerInner>,
}

struct TransferManagerInner {
    state: Mutex<TransferManagerState>,
    queue_signal: Condvar,
    next_job_id: AtomicU64,
}

#[derive(Default)]
struct TransferManagerState {
    active_job: Option<ActiveTransferJobState>,
    queued_jobs: VecDeque<TransferJobRequest>,
    completed_jobs: VecDeque<TransferJobSnapshot>,
}

struct ActiveTransferJobState {
    snapshot: TransferJobSnapshot,
    runtime: Option<ActiveTransferRuntimeProgress>,
    control: TransferJobControlHandle,
    event_emitter: TransferEventEmitter,
}

#[derive(Clone, Default)]
struct ActiveTransferRuntimeProgress {
    progress_kind: Option<TransferProgressKind>,
    committed_files: usize,
    committed_bytes: u64,
    current_file_path: Option<String>,
    current_file_total_bytes: Option<u64>,
    current_file_copied_bytes: u64,
}

enum TransferOperation {
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
}

enum TransferOperationResult {
    Copy(fs::CopyReport),
    Transfer(fs::TransferReport),
    Delete(fs::DeleteReport),
    Trash(fs::TrashReport),
}

struct TransferOperationOutcome {
    result: Result<TransferOperationResult, String>,
    terminal_status: TransferJobStatus,
}

struct TransferJobRequest {
    snapshot: TransferJobSnapshot,
    event_emitter: TransferEventEmitter,
    operation: TransferOperation,
    completion_tx: mpsc::Sender<Result<TransferOperationResult, String>>,
    control: TransferJobControlHandle,
}

#[derive(Clone, Copy)]
struct TransferJobDescriptor {
    kind: TransferJobKind,
    capabilities: TransferJobCapabilities,
}

#[derive(Clone)]
struct TransferEventEmitter {
    app_handle: tauri::AppHandle,
    transfer_id: Option<String>,
}

impl TransferEventEmitter {
    fn emit(&self, update: &fs::TransferProgressUpdate) {
        let Some(transfer_id) = self.transfer_id.clone() else {
            return;
        };
        let payload = fs::TransferProgress {
            id: transfer_id,
            processed: update.processed,
            total: update.total,
            current_path: update.current_path.clone(),
            current_bytes: update.current_bytes,
            current_total_bytes: update.current_total_bytes,
        };
        let _ = self.app_handle.emit("transfer_progress", payload);
    }

    fn emit_snapshot(&self, snapshot: &TransferQueueSnapshot) {
        let _ = self
            .app_handle
            .emit("transfer_jobs_snapshot", snapshot.clone());
    }
}

impl ActiveTransferRuntimeProgress {
    fn from_plan(plan: &PlannedTransferJob) -> Self {
        Self {
            progress_kind: Some(plan.progress_kind),
            ..Self::default()
        }
    }

    fn update_snapshot(
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

    fn finalize_success(&mut self, snapshot: &mut TransferJobSnapshot) {
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
        let snapshot =
            self.build_initial_snapshot(transfer_id.as_deref(), paths.len(), describe_copy_job());
        let event_emitter = self.build_event_emitter(window, transfer_id);
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
        let descriptor = describe_transfer_job(options.as_ref());
        let snapshot = self.build_initial_snapshot(transfer_id.as_deref(), paths.len(), descriptor);
        let event_emitter = self.build_event_emitter(window, transfer_id);
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
        let snapshot =
            self.build_initial_snapshot(transfer_id.as_deref(), paths.len(), describe_delete_job());
        let event_emitter = self.build_event_emitter(window, transfer_id);
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
        let snapshot =
            self.build_initial_snapshot(transfer_id.as_deref(), paths.len(), describe_trash_job());
        let event_emitter = self.build_event_emitter(window, transfer_id);
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

    fn build_initial_snapshot(
        &self,
        requested_id: Option<&str>,
        roots_total: usize,
        descriptor: TransferJobDescriptor,
    ) -> TransferJobSnapshot {
        let id = requested_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| {
                let next = self.inner.next_job_id.fetch_add(1, Ordering::Relaxed);
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

    fn build_event_emitter(
        &self,
        window: tauri::Window,
        transfer_id: Option<String>,
    ) -> TransferEventEmitter {
        let trimmed = transfer_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        TransferEventEmitter {
            app_handle: window.app_handle().clone(),
            transfer_id: trimmed,
        }
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

fn describe_copy_job() -> TransferJobDescriptor {
    TransferJobDescriptor {
        kind: TransferJobKind::Copy,
        capabilities: transfer_job_capabilities(),
    }
}

fn describe_transfer_job(options: Option<&fs::TransferOptions>) -> TransferJobDescriptor {
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

fn describe_delete_job() -> TransferJobDescriptor {
    TransferJobDescriptor {
        kind: TransferJobKind::Delete,
        capabilities: cancel_only_job_capabilities(),
    }
}

fn describe_trash_job() -> TransferJobDescriptor {
    TransferJobDescriptor {
        kind: TransferJobKind::Trash,
        capabilities: cancel_only_job_capabilities(),
    }
}

fn snapshot_from_state(state: &TransferManagerState) -> TransferQueueSnapshot {
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

fn start_worker(inner: Arc<TransferManagerInner>) {
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

    let plan = {
        let control = job.control.clone();
        let mut on_control = move || control.checkpoint();
        match plan_job(&job.operation, Some(&mut on_control)) {
            Ok(plan) => {
                apply_job_plan(inner, &job.snapshot.id, &plan, &job.event_emitter);
                mark_job_executing(inner, &job.snapshot.id, &job.event_emitter);
                plan
            }
            Err(error) => {
                let terminal_status = terminal_status_for_error(&error);
                mark_job_finished(inner, &job.snapshot.id, terminal_status, &job.event_emitter);
                let _ = job.completion_tx.send(Err(error));
                return;
            }
        }
    };

    let outcome = match job.operation {
        TransferOperation::Copy {
            paths,
            destination,
            options,
        } => execute_copy_job(
            inner,
            &job.snapshot.id,
            &plan,
            &job.event_emitter,
            job.control.clone(),
            paths,
            destination,
            options,
        ),
        TransferOperation::Transfer {
            paths,
            destination,
            options,
        } => execute_transfer_job(
            inner,
            &job.snapshot.id,
            &plan,
            &job.event_emitter,
            job.control.clone(),
            paths,
            destination,
            options,
        ),
        TransferOperation::Delete { paths } => execute_delete_job(
            inner,
            &job.snapshot.id,
            &plan,
            &job.event_emitter,
            job.control.clone(),
            paths,
        ),
        TransferOperation::Trash { paths } => execute_trash_job(
            inner,
            &job.snapshot.id,
            &plan,
            &job.event_emitter,
            job.control.clone(),
            paths,
        ),
    };

    mark_job_finished(
        inner,
        &job.snapshot.id,
        outcome.terminal_status,
        &job.event_emitter,
    );
    let _ = job.completion_tx.send(outcome.result);
}

fn terminal_status_for_error(error: &str) -> TransferJobStatus {
    if error == TRANSFER_CANCELLED_MESSAGE {
        TransferJobStatus::Cancelled
    } else {
        TransferJobStatus::Failed
    }
}

fn plan_job(
    operation: &TransferOperation,
    on_control: Option<&mut fs::TransferControlCallback>,
) -> Result<PlannedTransferJob, String> {
    match operation {
        TransferOperation::Copy {
            paths,
            destination,
            options,
        } => plan_copy_job(paths, destination, options.as_ref(), on_control),
        TransferOperation::Transfer {
            paths,
            destination,
            options,
        } => plan_transfer_job(paths, destination, options.as_ref(), on_control),
        TransferOperation::Delete { paths } | TransferOperation::Trash { paths } => {
            Ok(plan_root_only_job(paths))
        }
    }
}

fn execute_copy_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    paths: Vec<String>,
    destination: String,
    options: Option<fs::CopyOptions>,
) -> TransferOperationOutcome {
    let manager = Arc::clone(inner);
    let manager_job_id = job_id.to_string();
    let progress_kind = plan.progress_kind;
    let event_emitter = event_emitter.clone();
    let mut callback = move |update: fs::TransferProgressUpdate| {
        update_running_progress(
            &manager,
            &manager_job_id,
            progress_kind,
            &update,
            &event_emitter,
        );
        event_emitter.emit(&update);
    };
    let mut on_control = move || control.checkpoint();
    let result = fs::copy_entries(
        paths,
        destination,
        options,
        Some(&mut callback),
        Some(&mut on_control),
    )
    .map(TransferOperationResult::Copy);

    let terminal_status = match &result {
        Ok(_) => TransferJobStatus::Completed,
        Err(error) => terminal_status_for_error(error),
    };

    TransferOperationOutcome {
        result,
        terminal_status,
    }
}

fn execute_transfer_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    paths: Vec<String>,
    destination: String,
    options: Option<fs::TransferOptions>,
) -> TransferOperationOutcome {
    let manager = Arc::clone(inner);
    let manager_job_id = job_id.to_string();
    let progress_kind = plan.progress_kind;
    let event_emitter = event_emitter.clone();
    let mut callback = move |update: fs::TransferProgressUpdate| {
        update_running_progress(
            &manager,
            &manager_job_id,
            progress_kind,
            &update,
            &event_emitter,
        );
        event_emitter.emit(&update);
    };
    let mut on_control = move || control.checkpoint();
    let result = fs::transfer_entries(
        paths,
        destination,
        options,
        Some(&mut callback),
        Some(&mut on_control),
    )
    .map(TransferOperationResult::Transfer);

    let terminal_status = match &result {
        Ok(_) => TransferJobStatus::Completed,
        Err(error) => terminal_status_for_error(error),
    };

    TransferOperationOutcome {
        result,
        terminal_status,
    }
}

fn execute_delete_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    paths: Vec<String>,
) -> TransferOperationOutcome {
    let manager = Arc::clone(inner);
    let manager_job_id = job_id.to_string();
    let progress_kind = plan.progress_kind;
    let event_emitter = event_emitter.clone();
    let mut callback = move |update: fs::TransferProgressUpdate| {
        update_running_progress(
            &manager,
            &manager_job_id,
            progress_kind,
            &update,
            &event_emitter,
        );
        event_emitter.emit(&update);
    };
    let mut on_control = move || control.checkpoint();
    match fs::delete_entries(paths, Some(&mut callback), Some(&mut on_control)) {
        Ok(report) => TransferOperationOutcome {
            terminal_status: if report.cancelled {
                TransferJobStatus::Cancelled
            } else {
                TransferJobStatus::Completed
            },
            result: Ok(TransferOperationResult::Delete(report)),
        },
        Err(error) => TransferOperationOutcome {
            terminal_status: terminal_status_for_error(&error),
            result: Err(error),
        },
    }
}

fn execute_trash_job(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    plan: &PlannedTransferJob,
    event_emitter: &TransferEventEmitter,
    control: TransferJobControlHandle,
    paths: Vec<String>,
) -> TransferOperationOutcome {
    let manager = Arc::clone(inner);
    let manager_job_id = job_id.to_string();
    let progress_kind = plan.progress_kind;
    let event_emitter = event_emitter.clone();
    let mut callback = move |update: fs::TransferProgressUpdate| {
        update_running_progress(
            &manager,
            &manager_job_id,
            progress_kind,
            &update,
            &event_emitter,
        );
        event_emitter.emit(&update);
    };
    let mut on_control = move || control.checkpoint();
    match fs::trash_entries(paths, Some(&mut callback), Some(&mut on_control)) {
        Ok(report) => TransferOperationOutcome {
            terminal_status: if report.cancelled {
                TransferJobStatus::Cancelled
            } else {
                TransferJobStatus::Completed
            },
            result: Ok(TransferOperationResult::Trash(report)),
        },
        Err(error) => TransferOperationOutcome {
            terminal_status: terminal_status_for_error(&error),
            result: Err(error),
        },
    }
}

fn activate_job(inner: &Arc<TransferManagerInner>, job: &TransferJobRequest) {
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

fn apply_job_plan(
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

fn mark_job_executing(
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
        snapshot_from_state(&guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}

fn update_running_progress(
    inner: &Arc<TransferManagerInner>,
    job_id: &str,
    progress_kind: TransferProgressKind,
    update: &fs::TransferProgressUpdate,
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

        active.snapshot.work.roots_total = update.total;
        active.snapshot.work.roots_completed = update.processed;
        if matches!(progress_kind, TransferProgressKind::Roots) {
            active.snapshot.work.files_total = None;
            active.snapshot.work.bytes_total = None;
            active.snapshot.work.files_completed = 0;
            active.snapshot.work.bytes_completed = 0;
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
        snapshot_from_state(&guard)
    };
    event_emitter.emit_snapshot(&snapshot);
}

fn mark_job_finished(
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
