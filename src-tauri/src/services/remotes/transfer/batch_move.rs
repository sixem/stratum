// Preserve each completed move when a later move fails or is cancelled.
use super::{BatchItemResult, BatchResult, TransferResult};

pub(crate) fn collect_moves<T>(
    entries: &[T],
    mut checkpoint: impl FnMut() -> Result<(), String>,
    mut move_one: impl FnMut(usize, &T) -> Result<TransferResult, String>,
) -> BatchResult {
    let mut items = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        if checkpoint().is_err() {
            return BatchResult {
                items,
                cancelled: true,
            };
        }
        let (result, error) = match move_one(index, entry) {
            Ok(result) => (Some(result), None),
            Err(error) => (None, Some(error)),
        };
        items.push(BatchItemResult {
            index,
            result,
            error,
            skipped: false,
        });
    }
    BatchResult {
        items,
        cancelled: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failures_and_cancellation_keep_the_results_of_completed_moves() {
        let mut checks = 0;
        let report = collect_moves(
            &["first", "conflict", "unattempted"],
            || {
                checks += 1;
                if checks == 3 {
                    Err("Transfer cancelled".into())
                } else {
                    Ok(())
                }
            },
            |_, entry| {
                if *entry == "conflict" {
                    return Err("Destination exists".into());
                }
                Ok(TransferResult {
                    path: entry.to_string(),
                    backup: None,
                    warning: None,
                    local_path: None,
                })
            },
        );
        assert!(report.cancelled);
        assert_eq!(report.items.len(), 2);
        assert_eq!(report.items[0].result.as_ref().unwrap().path, "first");
        assert_eq!(report.items[1].error.as_deref(), Some("Destination exists"));
    }

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_OPERATIONS_DIR to the disposable move fixture"]
    fn queued_same_host_moves_report_partial_failure_and_cancellation() {
        use super::super::Transfer;
        use crate::services::{
            remotes::{operations::SelectedEntry, Remotes},
            transfer_manager::TransferManagerHandle,
        };
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc, Mutex,
        };
        use std::time::Duration;

        let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
        let base = std::env::var("STRATUM_SFTP_OPERATIONS_DIR").unwrap();
        let source = format!("{base}/move-source");
        let destination = format!("{base}/move-destination");
        let remotes = Remotes::default();
        let connection = tauri::async_runtime::block_on(remotes.connect(
            "move-fixture",
            &host,
            &base,
            Arc::new(|_| {}),
        ))
        .unwrap();
        let session = connection.session_id;
        let listing =
            tauri::async_runtime::block_on(remotes.list("move-fixture", &source, Some(session)))
                .unwrap();
        let select = |name: &str| {
            let item = listing
                .entries
                .iter()
                .find(|item| item.name == name)
                .unwrap();
            serde_json::from_value::<SelectedEntry>(serde_json::json!({
                "name": item.name, "isDir": item.is_dir, "isSymlink": item.is_symlink,
                "size": item.size, "modified": item.modified,
            })).unwrap()
        };
        let make_job = |entries, source_changed| Transfer {
            remotes: remotes.clone(),
            profile: "move-fixture".into(),
            session,
            direction: super::super::Direction::Rename {
                parent: source.clone(),
                destination: destination.clone(),
                entries,
            },
            replace: false,
            moving: true,
            recovery: None,
            expected: None,
            source_changed,
        };
        let manager = TransferManagerHandle::init();
        let report = manager
            .remote_move_fixture(
                make_job(vec![select("first"), select("conflict")], None),
                "move-partial",
            )
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .unwrap();
        assert!(!report.cancelled);
        assert!(report.items[0].result.is_some());
        assert!(report.items[1].error.is_some());

        let (reached_tx, reached_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let resume_rx = Mutex::new(resume_rx);
        let first = AtomicBool::new(true);
        let notify = Arc::new(move |_| {
            if first.swap(false, Ordering::SeqCst) {
                reached_tx.send(()).unwrap();
                resume_rx
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(10))
                    .unwrap();
            }
        });
        let completion = manager.remote_move_fixture(
            make_job(
                vec![select("cancel-first"), select("cancel-second")],
                Some(notify),
            ),
            "move-cancel",
        );
        reached_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(manager.cancel_job("move-cancel").unwrap());
        resume_tx.send(()).unwrap();
        let report = completion
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .unwrap();
        assert!(report.cancelled);
        assert_eq!(report.items.len(), 1);
        assert!(report.items[0].result.is_some());
        assert!(tauri::async_runtime::block_on(remotes.exists(
            "move-fixture",
            session,
            &format!("{source}/cancel-second")
        ))
        .unwrap());
        tauri::async_runtime::block_on(remotes.disconnect("move-fixture"));
    }
}
