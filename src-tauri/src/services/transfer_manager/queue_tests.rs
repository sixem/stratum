use super::super::TransferShutdownMode;
use super::*;
use crate::domain::filesystem::transfer::job_plan::plan_copy_job;
use crate::services::transfer_manager::manager_events::TransferEventEmitter;
use crate::services::transfer_manager::manager_state::TransferJobDescriptor;
use std::fs as disk;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const TIMEOUT: Duration = Duration::from_secs(10);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
        let path = std::env::temp_dir().join(format!(
            "stratum-transfer-workers-{}-{}",
            std::process::id(),
            nonce.as_nanos()
        ));
        disk::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = disk::remove_dir_all(&self.0);
    }
}

type JobResult = Result<TransferOperationResult, String>;

fn request(
    manager: &TransferManagerHandle,
    id: &str,
    descriptor: TransferJobDescriptor,
    operation: TransferOperation,
) -> (TransferJobRequest, mpsc::Receiver<JobResult>) {
    let (completion_tx, completion_rx) = mpsc::channel();
    let job = TransferJobRequest {
        snapshot: build_initial_snapshot(&manager.inner.next_job_id, Some(id), 1, descriptor),
        event_emitter: TransferEventEmitter::silent(),
        operation,
        completion_tx,
        control: TransferJobControlHandle::new(),
    };
    (job, completion_rx)
}

struct HeldCopy {
    control: TransferJobControlHandle,
    completion: mpsc::Receiver<JobResult>,
}

impl Drop for HeldCopy {
    fn drop(&mut self) {
        // Release the worker even if an assertion fails while the copy is held.
        let _ = self.control.cancel();
        let _ = self.completion.recv_timeout(TIMEOUT);
    }
}

fn hold_copy(manager: &TransferManagerHandle, copy_path: String, destination: String) -> HeldCopy {
    let copy_paths = vec![copy_path];
    let plan = plan_copy_job(&copy_paths, &destination, None, None).unwrap();
    let (copy, completion) = request(
        manager,
        "copy",
        describe_copy_job(),
        TransferOperation::Copy {
            paths: copy_paths,
            destination,
            options: None,
        },
    );
    let held_copy = HeldCopy {
        control: copy.control.clone(),
        completion,
    };
    held_copy.control.pause().unwrap();
    // Start with a prepared job so the pause holds a real executor, instead
    // of blocking the planner before the job can become active.
    {
        let paths = TransferJobPaths::from_operation(&copy.operation);
        let mut state = manager.inner.state.lock().unwrap();
        state.queued_jobs.push_back(QueuedTransferJobState {
            request: copy,
            planning_state: QueuedTransferPlanningState::Ready(plan),
            paths,
        });
    }
    manager.inner.queue_signal.notify_all();
    let start = Instant::now();
    while !manager
        .snapshot()
        .active_jobs
        .iter()
        .any(|job| job.id == "copy")
    {
        assert!(
            start.elapsed() < TIMEOUT,
            "the paused copy never became active"
        );
        thread::sleep(Duration::from_millis(5));
    }
    held_copy
}

#[test]
fn paused_copy_allows_a_small_move_past_an_overlapping_queued_job() {
    let temp = TestDirectory::new();
    let source = temp.0.join("source");
    let target = temp.0.join("target");
    disk::create_dir(&source).unwrap();
    disk::create_dir(&target).unwrap();
    let copy_source = source.join("large.bin");
    let move_source = source.join("small.txt");
    disk::write(&copy_source, b"copy payload").unwrap();
    disk::write(&move_source, b"move payload").unwrap();

    let manager = TransferManagerHandle::init();
    let copy_path = copy_source.to_string_lossy().into_owned();
    let destination = target.to_string_lossy().into_owned();
    let held_copy = hold_copy(&manager, copy_path.clone(), destination.clone());

    let (overlap, overlap_result) = request(
        &manager,
        "delete-copy-source",
        describe_delete_job(),
        TransferOperation::Delete {
            paths: vec![copy_path],
        },
    );
    manager.enqueue(overlap).unwrap();

    let options = Some(fs::TransferOptions {
        mode: Some(fs::TransferMode::Move),
        ..Default::default()
    });
    let (independent, move_result) = request(
        &manager,
        "move",
        describe_transfer_job(options.as_ref()),
        TransferOperation::Transfer {
            paths: vec![move_source.to_string_lossy().into_owned()],
            destination,
            options,
            #[cfg(windows)]
            drop_stage: None,
        },
    );
    manager.enqueue(independent).unwrap();

    let result = move_result.recv_timeout(TIMEOUT).unwrap().unwrap();
    assert!(matches!(result, TransferOperationResult::Transfer(report) if report.moved == 1));
    assert!(!move_source.exists());
    assert_eq!(
        disk::read(target.join("small.txt")).unwrap(),
        b"move payload"
    );
    assert!(copy_source.exists());
    assert!(matches!(
        held_copy.completion.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));
    let snapshot = manager.snapshot();
    assert_eq!(snapshot.queued_jobs.len(), 1);
    assert_eq!(snapshot.queued_jobs[0].id, "delete-copy-source");
    assert!(snapshot.queued_jobs[0].status == TransferJobStatus::Queued);

    assert!(manager.cancel_job("delete-copy-source").unwrap());
    assert!(matches!(
        overlap_result.recv_timeout(TIMEOUT).unwrap(),
        Err(error) if error == TRANSFER_CANCELLED_MESSAGE
    ));
    assert!(manager.resume_job("copy").unwrap());
    let result = held_copy.completion.recv_timeout(TIMEOUT).unwrap().unwrap();
    assert!(matches!(result, TransferOperationResult::Copy(report) if report.copied == 1));
    assert_eq!(
        disk::read(target.join("large.bin")).unwrap(),
        b"copy payload"
    );
}

fn held_shutdown_copy() -> (TestDirectory, TransferManagerHandle, String, HeldCopy) {
    let temp = TestDirectory::new();
    let source = temp.0.join("source.bin");
    let target = temp.0.join("target");
    disk::write(&source, b"copy payload").unwrap();
    disk::create_dir(&target).unwrap();
    let copy_path = source.to_string_lossy().into_owned();
    let manager = TransferManagerHandle::init();
    let held = hold_copy(
        &manager,
        copy_path.clone(),
        target.to_string_lossy().into_owned(),
    );
    (temp, manager, copy_path, held)
}

fn await_shutdown(
    manager: &TransferManagerHandle,
    ticket: u64,
) -> mpsc::Receiver<Result<bool, String>> {
    let (tx, rx) = mpsc::channel();
    let manager = manager.clone();
    thread::spawn(move || {
        let _ = tx.send(manager.wait_for_shutdown(ticket));
    });
    rx
}

#[test]
fn waiting_to_close_resumes_paused_jobs_and_stops_admission() {
    let (temp, manager, copy_path, held_copy) = held_shutdown_copy();
    assert!(manager
        .begin_shutdown(TransferShutdownMode::IdleOnly)
        .unwrap()
        .is_none());
    let ticket = manager
        .begin_shutdown(TransferShutdownMode::Wait)
        .unwrap()
        .unwrap();

    let (job, _) = request(
        &manager,
        "late-delete",
        describe_delete_job(),
        TransferOperation::Delete {
            paths: vec![copy_path],
        },
    );
    assert!(manager.enqueue(job).unwrap_err().contains("closing"));
    assert!(await_shutdown(&manager, ticket)
        .recv_timeout(TIMEOUT)
        .unwrap()
        .unwrap());
    let result = held_copy.completion.recv_timeout(TIMEOUT).unwrap().unwrap();
    assert!(matches!(result, TransferOperationResult::Copy(report) if report.copied == 1));
    assert_eq!(
        disk::read(temp.0.join("target/source.bin")).unwrap(),
        b"copy payload"
    );

    assert!(manager.reopen_queue(ticket).unwrap());
    let next = manager
        .begin_shutdown(TransferShutdownMode::IdleOnly)
        .unwrap()
        .unwrap();
    assert!(!manager.reopen_queue(ticket).unwrap());
    assert!(!manager.wait_for_shutdown(ticket).unwrap());
    assert!(manager.reopen_queue(next).unwrap());
}

#[test]
fn cancelling_to_close_drains_active_and_queued_jobs() {
    let (temp, manager, copy_path, held_copy) = held_shutdown_copy();
    let (job, queued_completion) = request(
        &manager,
        "queued-delete",
        describe_delete_job(),
        TransferOperation::Delete {
            paths: vec![copy_path],
        },
    );
    manager.enqueue(job).unwrap();

    let ticket = manager
        .begin_shutdown(TransferShutdownMode::Cancel)
        .unwrap()
        .unwrap();
    assert!(await_shutdown(&manager, ticket)
        .recv_timeout(TIMEOUT)
        .unwrap()
        .unwrap());
    for completion in [&held_copy.completion, &queued_completion] {
        assert!(matches!(
            completion.recv_timeout(TIMEOUT).unwrap(),
            Err(error) if error == TRANSFER_CANCELLED_MESSAGE
        ));
    }
    assert!(temp.0.join("source.bin").is_file());
    assert!(!temp.0.join("target/source.bin").exists());
    assert!(manager.reopen_queue(ticket).unwrap());
}
