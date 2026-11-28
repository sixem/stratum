// Conflict checks and the cancellable handoff to the replacement prompt.
use super::{conflict_for, remote_destination, Direction, Transfer};
use std::{
    collections::{HashMap, HashSet},
    sync::{mpsc, Mutex, OnceLock},
};
use tauri::Emitter;

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Decision {
    Replace,
    Skip,
    Cancel,
}

type Pending = HashMap<String, mpsc::Sender<Decision>>;
fn pending() -> &'static Mutex<Pending> {
    static PENDING: OnceLock<Mutex<Pending>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) struct PendingDecision {
    id: String,
    receiver: mpsc::Receiver<Decision>,
}

impl PendingDecision {
    #[cfg(test)]
    pub(super) fn fixture(decision: Decision) -> Self {
        let (sender, receiver) = mpsc::channel();
        sender.send(decision).unwrap();
        Self {
            id: String::new(),
            receiver,
        }
    }

    pub(crate) fn wait(
        &self,
        checkpoint: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<Decision, String> {
        loop {
            checkpoint()?;
            match self
                .receiver
                .recv_timeout(std::time::Duration::from_millis(100))
            {
                Ok(decision) => return Ok(decision),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Replacement decision unavailable.".into())
                }
            }
        }
    }
}

// A disconnected-tab drop already has a Work ID while the webview connects SSH.
// It hands reporting to the native queue only when it submits the transfer.
pub(super) fn ended(
    events: &crate::services::operation_events::OperationEvents,
    id: Option<&str>,
    cancelled: bool,
) {
    use crate::services::operation_events::{Origin, TransferOutcome};
    let outcome = if cancelled {
        TransferOutcome::Cancelled
    } else {
        TransferOutcome::Failed
    };
    events
        .operation(id, Origin::User, [])
        .finish_transfer(outcome, Default::default());
}

#[tauri::command]
pub(crate) fn remote_transfer_preflight_ended(
    webview: tauri::Webview,
    transfer_id: String,
    cancelled: bool,
) -> Result<(), String> {
    use tauri::Manager;
    super::super::manager(&webview)?;
    ended(&webview.state(), Some(&transfer_id), cancelled);
    Ok(())
}

impl Drop for PendingDecision {
    fn drop(&mut self) {
        if let Ok(mut pending) = pending().lock() {
            pending.remove(&self.id);
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConflictPrompt {
    transfer_id: String,
    indices: Vec<usize>,
}

pub(super) fn request_decision(
    app: &tauri::AppHandle,
    id: &str,
    indices: Vec<usize>,
) -> Result<PendingDecision, String> {
    let (sender, receiver) = mpsc::channel();
    let mut entries = pending()
        .lock()
        .map_err(|_| "Replacement decision unavailable.")?;
    if entries.contains_key(id) {
        return Err("A replacement decision is already pending.".into());
    }
    entries.insert(id.to_owned(), sender);
    drop(entries);
    let decision = PendingDecision {
        id: id.to_owned(),
        receiver,
    };
    app.emit_to(
        "main",
        "remote-transfer-conflicts",
        ConflictPrompt {
            transfer_id: id.to_owned(),
            indices,
        },
    )
    .map_err(|error| format!("Could not request a replacement decision: {error}"))?;
    Ok(decision)
}

#[tauri::command]
pub(crate) fn remote_transfer_conflict_decision(
    transfer_id: String,
    decision: Decision,
) -> Result<(), String> {
    let sender = pending()
        .lock()
        .map_err(|_| "Replacement decision unavailable.")?
        .get(&transfer_id)
        .cloned();
    sender
        .ok_or("The replacement decision is no longer pending.")?
        .send(decision)
        .map_err(|_| "The replacement decision is no longer pending.".into())
}

// A complete destination listing replaces many round trips. If a server
// cannot provide one, individual checks retain the original semantics.
pub(crate) fn check_conflicts(
    jobs: &[Transfer],
    checkpoint: &mut (dyn FnMut() -> Result<(), String> + Send),
    progress: &mut dyn FnMut(usize),
) -> Result<Vec<Result<bool, String>>, String> {
    let mut listings: HashMap<(String, u32, String), Option<HashSet<String>>> = HashMap::new();
    let mut results = Vec::with_capacity(jobs.len());
    for (index, job) in jobs.iter().enumerate() {
        checkpoint()?;
        progress(index);
        let target = match &job.direction {
            Direction::Upload {
                local_path,
                remote_folder,
            } => remote_destination(local_path, remote_folder).map(|path| {
                (
                    job.profile.clone(),
                    job.session,
                    remote_folder.clone(),
                    path,
                )
            }),
            Direction::Remote {
                remote_path,
                dest_profile,
                dest_session,
                remote_folder,
            } => {
                let name = remote_path
                    .rsplit('/')
                    .next()
                    .filter(|name| !name.is_empty())
                    .ok_or("Invalid remote source.");
                name.map(|name| {
                    (
                        dest_profile.clone(),
                        *dest_session,
                        remote_folder.clone(),
                        format!("{}/{name}", remote_folder.trim_end_matches('/')),
                    )
                })
                .map_err(str::to_owned)
            }
            _ => Err(String::new()),
        };
        let cached = if jobs.len() >= 4 {
            if let Ok((profile, session, folder, path)) = &target {
                let listing = listings
                    .entry((profile.clone(), *session, folder.clone()))
                    .or_insert_with(|| {
                        tauri::async_runtime::block_on(
                            job.remotes
                                .list_for_transfer(profile, folder, *session, checkpoint),
                        )
                        .ok()
                        .filter(|listing| listing.omitted_entries == 0)
                        .map(|listing| {
                            listing
                                .entries
                                .into_iter()
                                .map(|entry| entry.name)
                                .collect()
                        })
                    });
                listing
                    .as_ref()
                    .map(|names| names.contains(path.rsplit('/').next().unwrap_or("")))
            } else {
                None
            }
        } else {
            None
        };
        checkpoint()?;
        results.push(match cached {
            Some(found) => Ok(found),
            None => tauri::async_runtime::block_on(conflict_for(job)),
        });
    }
    checkpoint()?;
    Ok(results)
}

#[cfg(test)]
mod tests {
    #[test]
    fn connection_preflight_has_one_terminal_event_and_no_item_outcomes() {
        use crate::services::operation_events::{
            testing::Observed, OperationEvents, TransferOutcome,
        };
        let events = OperationEvents::default();
        let mut seen = Observed::subscribe(&events);
        for (cancelled, outcome) in [
            (true, TransferOutcome::Cancelled),
            (false, TransferOutcome::Failed),
        ] {
            super::ended(&events, Some("connecting"), cancelled);
            seen.terminal("connecting", outcome, Default::default());
        }
    }
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    #[test]
    fn cancelling_while_waiting_for_a_conflict_decision_releases_the_request() {
        let (sender, receiver) = mpsc::channel();
        let id = "cancelled-conflict-test".to_owned();
        pending().lock().unwrap().insert(id.clone(), sender);
        let decision = PendingDecision {
            id: id.clone(),
            receiver,
        };
        let cancelled = Arc::new(AtomicBool::new(false));
        let trigger = cancelled.clone();
        let worker = std::thread::spawn(move || {
            decision.wait(&mut || {
                if trigger.load(Ordering::SeqCst) {
                    Err("Transfer cancelled".into())
                } else {
                    Ok(())
                }
            })
        });
        cancelled.store(true, Ordering::SeqCst);
        assert_eq!(
            worker.join().unwrap().err().as_deref(),
            Some("Transfer cancelled")
        );
        assert!(!pending().lock().unwrap().contains_key(&id));
    }

    #[test]
    fn download_preflight_reports_conflicts_and_stops_when_cancelled() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let folder = std::env::temp_dir().join(format!(
            "stratum-preflight-{:032x}",
            u128::from_le_bytes(random)
        ));
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("existing.txt"), b"keep").unwrap();
        let job = |name: &str| Transfer {
            remotes: super::super::super::Remotes::default(),
            profile: "test".into(),
            session: 1,
            direction: Direction::Download {
                remote_path: format!("/source/{name}"),
                local_folder: folder.clone(),
            },
            replace: false,
            moving: false,
            recovery: None,
            expected: None,
            source_changed: None,
        };
        let jobs = vec![job("existing.txt"), job("new.txt")];
        let results = check_conflicts(&jobs, &mut || Ok(()), &mut |_| {}).unwrap();
        assert!(*results[0].as_ref().unwrap());
        assert!(!*results[1].as_ref().unwrap());
        let mut checks = 0;
        let cancelled = check_conflicts(
            &jobs,
            &mut || {
                checks += 1;
                if checks >= 3 {
                    Err("Transfer cancelled".into())
                } else {
                    Ok(())
                }
            },
            &mut |_| {},
        );
        assert_eq!(cancelled.err().as_deref(), Some("Transfer cancelled"));
        assert_eq!(std::fs::read(folder.join("existing.txt")).unwrap(), b"keep");
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_OPERATIONS_DIR to a disposable fixture containing occupied.txt"]
    fn live_destination_listing_checks_a_batch_and_preserves_connection_on_cancel() {
        use std::sync::Arc;
        let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
        let folder = std::env::var("STRATUM_SFTP_OPERATIONS_DIR").unwrap();
        let remotes = super::super::super::Remotes::default();
        let session = tauri::async_runtime::block_on(remotes.connect(
            "preflight-fixture",
            &host,
            &folder,
            Arc::new(|_| {}),
        ))
        .unwrap();
        let jobs: Vec<_> = ["occupied.txt", "missing-a", "missing-b", "missing-c"]
            .into_iter()
            .map(|name| Transfer {
                remotes: remotes.clone(),
                profile: "preflight-fixture".into(),
                session: session.session_id,
                direction: Direction::Upload {
                    local_path: std::path::PathBuf::from(format!("C:\\fixture\\{name}")),
                    remote_folder: folder.clone(),
                },
                replace: false,
                moving: false,
                recovery: None,
                expected: None,
                source_changed: None,
            })
            .collect();
        let results = check_conflicts(&jobs, &mut || Ok(()), &mut |_| {}).unwrap();
        assert_eq!(
            results
                .into_iter()
                .map(|result| result.unwrap())
                .collect::<Vec<_>>(),
            vec![true, false, false, false]
        );
        let mut checks = 0;
        let cancelled = check_conflicts(
            &jobs,
            &mut || {
                checks += 1;
                if checks >= 3 {
                    Err("Transfer cancelled".into())
                } else {
                    Ok(())
                }
            },
            &mut |_| {},
        );
        assert_eq!(cancelled.err().as_deref(), Some("Transfer cancelled"));
        assert!(tauri::async_runtime::block_on(remotes.exists(
            "preflight-fixture",
            session.session_id,
            &format!("{folder}/occupied.txt")
        ))
        .unwrap());
        tauri::async_runtime::block_on(remotes.disconnect("preflight-fixture"));
    }
}
