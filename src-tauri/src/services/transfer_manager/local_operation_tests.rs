// Run actual local jobs and inspect the internal stream before the IPC result is returned.
use super::*;
use crate::services::operation_events::{
    DeleteMethod, EntryKind, EventDetails, ItemChange, Location, OperationEvent, OperationEvents,
    TransferCounts,
};
use tokio::sync::broadcast::{error::TryRecvError, Receiver};

fn path(p: &std::path::Path) -> String {
    p.to_str().unwrap().to_owned()
}
fn finish(
    manager: &TransferManagerHandle,
    request: (TransferJobRequest, mpsc::Receiver<JobResult>),
) -> JobResult {
    let (job, response) = request;
    manager.enqueue(job).unwrap();
    response.recv_timeout(TIMEOUT).unwrap()
}
fn terminal(rx: &mut Receiver<Arc<OperationEvent>>, id: &str, name: &str, counts: TransferCounts) {
    let event = rx.try_recv().unwrap();
    assert_eq!(event.operation_id, id);
    assert_eq!(event.name(), name);
    assert!(
        matches!(&event.details, EventDetails::Transfer { counts: actual, .. } if actual == &counts)
    );
    assert_eq!(rx.try_recv().unwrap_err(), TryRecvError::Empty);
}

#[cfg(windows)]
#[test]
fn rejected_remote_job_reports_one_failed_terminal_event() {
    use crate::services::remotes::{
        transfer::{Direction, Transfer},
        Remotes,
    };
    let events = OperationEvents::default();
    let mut rx = events.subscribe();
    let manager = TransferManagerHandle::with_events(events);
    manager.inner.state.lock().unwrap().shutdown_ticket = Some(1);
    let job = Transfer {
        remotes: Remotes::default(),
        profile: "profile".into(),
        session: 1,
        direction: Direction::Upload {
            local_path: "C:\\source.txt".into(),
            remote_folder: "/destination".into(),
        },
        replace: false,
        moving: false,
        recovery: None,
        expected: None,
        source_changed: None,
    };
    let (job, _) = request(
        &manager,
        "rejected-remote",
        super::super::super::manager_state::describe_remote_job(false),
        TransferOperation::Remote(job),
    );
    assert!(manager.enqueue(job).is_err());
    terminal(
        &mut rx,
        "rejected-remote",
        "transfer.failed",
        TransferCounts::default(),
    );
}

#[test]
fn work_copy_reports_final_duplicate_names_and_skips_conflicts() {
    let dir = TestDirectory::new();
    let file = dir.0.join("note.txt");
    let folder = dir.0.join("tree");
    disk::create_dir(&folder).unwrap();
    disk::write(folder.join("child"), b"nested").unwrap();
    disk::write(&file, b"one").unwrap();
    disk::write(dir.0.join("note (1).txt"), b"occupied").unwrap();
    let events = OperationEvents::default();
    let mut rx = events.subscribe();
    let manager = TransferManagerHandle::with_events(events);
    let job = request(
        &manager,
        "duplicate",
        describe_copy_job(),
        TransferOperation::Copy {
            paths: vec![path(&file), path(&folder)],
            destination: path(&dir.0),
            options: None,
        },
    );
    assert!(matches!(finish(&manager, job), Ok(TransferOperationResult::Copy(r)) if r.copied == 2));
    for (src, dest, kind) in [
        (&file, dir.0.join("note (2).txt"), EntryKind::File),
        (&folder, dir.0.join("tree (1)"), EntryKind::Directory),
    ] {
        assert!(dest.exists());
        let event = rx.try_recv().unwrap();
        assert_eq!(event.operation_id, "duplicate");
        assert!(
            matches!(&event.details, EventDetails::Item { kind: k, change: ItemChange::Copied { source, destination } }
            if *k == kind && source == &Location::Local(src.clone()) && destination == &Location::Local(dest))
        );
    }
    terminal(
        &mut rx,
        "duplicate",
        "transfer.completed",
        TransferCounts {
            copied: 2,
            ..Default::default()
        },
    );

    let skipped = folder.join("note.txt");
    disk::write(&skipped, b"keep").unwrap();
    let job = request(
        &manager,
        "skip",
        describe_copy_job(),
        TransferOperation::Copy {
            paths: vec![path(&file)],
            destination: path(&folder),
            options: Some(fs::CopyOptions {
                skip_paths: Some(vec![path(&skipped)]),
                overwrite_paths: None,
            }),
        },
    );
    assert!(finish(&manager, job).is_ok());
    assert_eq!(disk::read(skipped).unwrap(), b"keep");
    terminal(
        &mut rx,
        "skip",
        "transfer.completed",
        TransferCounts {
            skipped: 1,
            ..Default::default()
        },
    );
}

#[test]
fn partial_directory_merge_counts_each_skipped_conflict_without_a_directory_event() {
    let dir = TestDirectory::new();
    let source = dir.0.join("tree");
    let target = dir.0.join("target");
    let merged = target.join("tree");
    disk::create_dir(&source).unwrap();
    disk::create_dir_all(&merged).unwrap();
    for name in ["one", "two", "three"] {
        disk::write(source.join(name), b"new").unwrap();
    }
    let conflicts = [merged.join("one"), merged.join("two")];
    for file in &conflicts {
        disk::write(file, b"keep").unwrap();
    }
    let events = OperationEvents::default();
    let mut rx = events.subscribe();
    let manager = TransferManagerHandle::with_events(events);
    let job = request(
        &manager,
        "merge",
        describe_copy_job(),
        TransferOperation::Copy {
            paths: vec![path(&source)],
            destination: path(&target),
            options: Some(fs::CopyOptions {
                skip_paths: Some(conflicts.iter().map(|p| path(p)).collect()),
                overwrite_paths: None,
            }),
        },
    );
    assert!(finish(&manager, job).is_ok());
    for file in conflicts {
        assert_eq!(disk::read(file).unwrap(), b"keep");
    }
    assert_eq!(disk::read(merged.join("three")).unwrap(), b"new");
    terminal(
        &mut rx,
        "merge",
        "transfer.completed",
        TransferCounts {
            skipped: 2,
            ..Default::default()
        },
    );
}

#[test]
fn work_move_reports_committed_roots_partial_failure_and_preflight_skips() {
    let dir = TestDirectory::new();
    let target = dir.0.join("target");
    let folder = dir.0.join("tree");
    let conflict = dir.0.join("occupied");
    disk::create_dir(&folder).unwrap();
    disk::create_dir(&target).unwrap();
    disk::write(&conflict, b"source").unwrap();
    disk::write(target.join("occupied"), b"keep").unwrap();
    let events = OperationEvents::default();
    let mut rx = events.subscribe();
    let manager = TransferManagerHandle::with_events(events);
    let options = Some(fs::TransferOptions {
        mode: Some(fs::TransferMode::Move),
        skipped_by_prompt: 2,
        ..Default::default()
    });
    let job = request(
        &manager,
        "move",
        describe_transfer_job(options.as_ref()),
        TransferOperation::Transfer {
            paths: vec![path(&folder), path(&conflict)],
            destination: path(&target),
            options,
            #[cfg(windows)]
            drop_stage: None,
        },
    );
    assert!(
        matches!(finish(&manager, job), Ok(TransferOperationResult::Transfer(r)) if r.moved == 1 && r.failures.len() == 1)
    );
    let event = rx.try_recv().unwrap();
    assert_eq!(event.name(), "directory.moved");
    assert!(
        matches!(&event.details, EventDetails::Item { change: ItemChange::Moved { source, destination }, .. }
        if source == &Location::Local(folder) && destination == &Location::Local(target.join("tree")))
    );
    terminal(
        &mut rx,
        "move",
        "transfer.failed",
        TransferCounts {
            moved: 1,
            skipped: 2,
            failed: 1,
            ..Default::default()
        },
    );
}

#[test]
fn copy_and_move_overwrite_only_report_the_committed_destination() {
    let dir = TestDirectory::new();
    let target = dir.0.join("target");
    disk::create_dir(&target).unwrap();
    let source = dir.0.join("note");
    let destination = target.join("note");
    disk::write(&destination, b"old").unwrap();
    let events = OperationEvents::default();
    let mut rx = events.subscribe();
    let manager = TransferManagerHandle::with_events(events);
    for mode in [fs::TransferMode::Copy, fs::TransferMode::Move] {
        let moving = matches!(mode, fs::TransferMode::Move);
        let (id, name) = if moving {
            ("move", "file.moved")
        } else {
            ("copy", "file.copied")
        };
        disk::write(&source, id).unwrap();
        let options = Some(fs::TransferOptions {
            mode: Some(mode),
            overwrite_paths: Some([destination.clone()].into()),
            ..Default::default()
        });
        let job = request(
            &manager,
            id,
            describe_transfer_job(options.as_ref()),
            TransferOperation::Transfer {
                paths: vec![path(&source)],
                destination: path(&target),
                options,
                #[cfg(windows)]
                drop_stage: None,
            },
        );
        assert!(finish(&manager, job).is_ok());
        let event = rx.try_recv().unwrap();
        assert_eq!(event.operation_id, id);
        assert_eq!(event.name(), name);
        assert!(
            matches!(&event.details, EventDetails::Item { change: ItemChange::Copied { source: from, destination: to } | ItemChange::Moved { source: from, destination: to }, .. }
            if *from == Location::Local(source.clone()) && *to == Location::Local(destination.clone()))
        );
        assert_eq!(disk::read(&destination).unwrap(), id.as_bytes());
        assert_eq!(source.exists(), !moving);
        terminal(
            &mut rx,
            id,
            "transfer.completed",
            TransferCounts {
                moved: usize::from(moving),
                copied: usize::from(!moving),
                ..Default::default()
            },
        );
    }
}

#[test]
fn cancellation_keeps_completed_copy_counts_when_the_caller_gets_an_error() {
    use crate::services::transfer_manager::{
        job_execution::terminal_status_for_error, local_events,
        manager_state::TransferOperationOutcome,
    };
    use std::cell::Cell;
    use std::rc::Rc;
    let dir = TestDirectory::new();
    let target = dir.0.join("target");
    disk::create_dir(&target).unwrap();
    let sources = ["one", "two"].map(|s| {
        let p = dir.0.join(s);
        disk::write(&p, s).unwrap();
        path(&p)
    });
    let events = OperationEvents::default();
    let mut rx = events.subscribe();
    let cancelled = Rc::new(Cell::new(false));
    let stop = cancelled.clone();
    let mut progress = move |update: fs::TransferProgressUpdate| {
        if update.completed_item.is_some() {
            stop.set(true);
        }
    };
    let mut control = move || {
        if cancelled.get() {
            Err(TRANSFER_CANCELLED_MESSAGE.into())
        } else {
            Ok(())
        }
    };
    local_events::run_transfer(&events, "cancel", &sources, 0, |report| {
        let result = fs::transfer::copy_entries_reported(
            &sources,
            path(&target),
            None,
            Some(&mut progress),
            Some(&mut control),
            report,
        );
        let Err(error) = result else {
            panic!("copy did not cancel")
        };
        TransferOperationOutcome {
            terminal_status: terminal_status_for_error(&error),
            result: Err(error),
        }
    });
    assert!(target.join("one").exists() && !target.join("two").exists());
    assert_eq!(rx.try_recv().unwrap().name(), "file.copied");
    terminal(
        &mut rx,
        "cancel",
        "transfer.cancelled",
        TransferCounts {
            copied: 1,
            ..Default::default()
        },
    );
}

#[test]
fn failed_planning_and_queued_cancellation_each_send_one_terminal_event() {
    let dir = TestDirectory::new();
    let source = dir.0.join("file");
    disk::write(&source, b"data").unwrap();
    let events = OperationEvents::default();
    let mut rx = events.subscribe();
    let manager = TransferManagerHandle::with_events(events);
    let bad = request(
        &manager,
        "plan",
        describe_copy_job(),
        TransferOperation::Copy {
            paths: vec![path(&source)],
            destination: path(&dir.0.join("missing")),
            options: None,
        },
    );
    assert!(finish(&manager, bad).is_err());
    terminal(
        &mut rx,
        "plan",
        "transfer.failed",
        TransferCounts::default(),
    );
    let target = dir.0.join("target");
    disk::create_dir(&target).unwrap();
    let _hold = hold_copy(&manager, path(&source), path(&target));
    let (job, completion) = request(
        &manager,
        "queued",
        describe_copy_job(),
        TransferOperation::Copy {
            paths: vec![path(&source)],
            destination: path(&target),
            options: None,
        },
    );
    manager.enqueue(job).unwrap();
    assert!(manager.cancel_job("queued").unwrap());
    assert!(completion.recv_timeout(TIMEOUT).unwrap().is_err());
    terminal(
        &mut rx,
        "queued",
        "transfer.cancelled",
        TransferCounts::default(),
    );
}

#[cfg(windows)]
#[test]
fn native_delete_emits_only_the_selected_successful_roots() {
    let dir = TestDirectory::new();
    let tree = dir.0.join("tree");
    let file = dir.0.join("file");
    disk::create_dir(&tree).unwrap();
    disk::write(tree.join("child"), b"data").unwrap();
    disk::write(&file, b"data").unwrap();
    let events = OperationEvents::default();
    let mut rx = events.subscribe();
    let manager = TransferManagerHandle::with_events(events);
    let job = request(
        &manager,
        "delete",
        describe_delete_job(),
        TransferOperation::Delete {
            paths: [&tree, &file, &dir.0.join("missing")]
                .map(|p| path(p))
                .to_vec(),
        },
    );
    assert!(
        matches!(finish(&manager, job), Ok(TransferOperationResult::Delete(r)) if r.deleted == 2 && !r.failures.is_empty())
    );
    let mut removed = vec![];
    while let Ok(event) = rx.try_recv() {
        assert_eq!(event.operation_id, "delete");
        let EventDetails::Item {
            kind,
            change:
                ItemChange::Deleted {
                    source,
                    method: DeleteMethod::Permanent,
                },
        } = &event.details
        else {
            panic!("{event:?}")
        };
        removed.push((*kind, source.clone()));
    }
    assert_eq!(removed.len(), 2, "{removed:?}");
    assert!(removed.contains(&(EntryKind::Directory, Location::Local(tree))));
    assert!(removed.contains(&(EntryKind::File, Location::Local(file))));
}

#[cfg(windows)]
#[test]
fn a_recreated_path_does_not_erase_a_confirmed_delete() {
    let dir = TestDirectory::new();
    let file = dir.0.join("file");
    disk::write(&file, b"original").unwrap();
    let replacement = file.clone();
    let mut progress = move |update: fs::TransferProgressUpdate| {
        if update
            .completed_item
            .is_some_and(|item| item.source_removed)
        {
            disk::write(&replacement, b"replacement").unwrap();
        }
    };
    let report = fs::delete_entries(vec![path(&file)], None, Some(&mut progress), None).unwrap();
    assert_eq!(disk::read(&file).unwrap(), b"replacement");
    assert_eq!(report.removed_roots.len(), 1);
    assert_eq!(report.removed_roots[0].path, path(&file));
}

#[test]
fn local_mutations_report_actual_creations_renames_and_guarded_folder_removal() {
    let dir = TestDirectory::new();
    let file = dir.0.join("old.txt");
    let folder = dir.0.join("old folder");
    let events = OperationEvents::default();
    let mut rx = events.subscribe();
    events.create_entry(path(&file), EntryKind::File).unwrap();
    events
        .create_entry(path(&folder), EntryKind::Directory)
        .unwrap();
    assert!(events.create_entry(path(&file), EntryKind::File).is_err());
    events
        .rename(Some("rename-batch"), path(&file), "new.txt".into(), None)
        .unwrap();
    events
        .rename(
            Some("rename-batch"),
            path(&folder),
            "old folder".into(),
            None,
        )
        .unwrap();
    assert!(events
        .rename(Some("rename-batch"), path(&folder), "new.txt".into(), None)
        .is_err());
    events
        .rename(
            Some("rename-batch"),
            path(&folder),
            "new folder".into(),
            None,
        )
        .unwrap();
    for (kind, source, destination) in [
        (EntryKind::File, &file, dir.0.join("new.txt")),
        (EntryKind::Directory, &folder, dir.0.join("new folder")),
    ] {
        assert!(destination.exists() && !source.exists());
        let event = rx.try_recv().unwrap();
        assert!(
            matches!(&event.details, EventDetails::Item { kind: k, change: ItemChange::Created { destination } }
            if *k == kind && destination == &Location::Local(source.clone()))
        );
    }
    for (name, src, dest) in [
        ("file.renamed", file, dir.0.join("new.txt")),
        ("directory.renamed", folder, dir.0.join("new folder")),
    ] {
        let event = rx.try_recv().unwrap();
        assert_eq!(event.name(), name);
        assert_eq!(event.operation_id, "rename-batch");
        assert!(
            matches!(&event.details, EventDetails::Item { change: ItemChange::Renamed { source, destination }, .. }
            if source == &Location::Local(src) && destination == &Location::Local(dest))
        );
    }
    let tracked = events
        .create_tracked_folder(path(&dir.0), "group".into())
        .unwrap();
    let child = dir.0.join("group/child");
    disk::write(&child, b"keep").unwrap();
    assert!(!events.remove_created_folder(tracked.clone()).unwrap());
    disk::remove_file(child).unwrap();
    assert!(events.remove_created_folder(tracked).unwrap());
    assert_eq!(rx.try_recv().unwrap().name(), "directory.created");
    assert_eq!(rx.try_recv().unwrap().name(), "directory.deleted");
    assert_eq!(rx.try_recv().unwrap_err(), TryRecvError::Empty);
}

#[cfg(windows)]
#[test]
#[ignore = "round-trips disposable items through the Windows user's Recycle Bin"]
fn windows_recycle_and_restore_report_the_actual_method_and_restored_paths() {
    let dir = TestDirectory::new();
    let file = dir.0.join("file.txt");
    let folder = dir.0.join("folder");
    disk::write(&file, b"keep").unwrap();
    disk::create_dir(&folder).unwrap();
    disk::write(folder.join("child"), b"keep").unwrap();
    let events = OperationEvents::default();
    let mut rx = events.subscribe();
    let manager = TransferManagerHandle::with_events(events.clone());
    let job = request(
        &manager,
        "recycle",
        describe_trash_job(),
        TransferOperation::Trash {
            paths: vec![path(&file), path(&folder)],
        },
    );
    let Ok(TransferOperationResult::Trash(report)) = finish(&manager, job) else {
        panic!("recycle job failed")
    };
    let restored = events
        .restore_recycle_items(report.recycle_undo_receipt.unwrap())
        .unwrap();
    assert!(restored.failures.is_empty(), "{:?}", restored.failures);
    assert_eq!(disk::read(&file).unwrap(), b"keep");
    assert_eq!(disk::read(folder.join("child")).unwrap(), b"keep");
    let mut deleted = vec![];
    let mut moved = vec![];
    while let Ok(event) = rx.try_recv() {
        match &event.details {
            EventDetails::Item {
                kind,
                change:
                    ItemChange::Deleted {
                        source,
                        method: DeleteMethod::RecycleBin,
                    },
            } => {
                assert_eq!(event.operation_id, "recycle");
                deleted.push((*kind, source.clone()));
            }
            EventDetails::Item {
                kind,
                change:
                    ItemChange::Moved {
                        source: Location::Local(bin),
                        destination,
                    },
            } => {
                assert!(bin.file_name().unwrap().to_str().unwrap().starts_with("$R"));
                moved.push((*kind, destination.clone()));
            }
            _ => panic!("{event:?}"),
        }
    }
    assert_eq!(deleted.len(), 2);
    assert!(deleted.contains(&(EntryKind::File, Location::Local(file.clone()))));
    assert!(deleted.contains(&(EntryKind::Directory, Location::Local(folder.clone()))));
    // The Recycle Bin records the Shell's expanded spelling of an 8.3 temp path.
    let restored_paths: Vec<_> = moved
        .into_iter()
        .map(|(kind, destination)| {
            let Location::Local(path) = destination else {
                panic!("expected a local restore")
            };
            (kind, disk::canonicalize(path).unwrap())
        })
        .collect();
    assert_eq!(restored_paths.len(), 2);
    assert!(restored_paths.contains(&(EntryKind::File, disk::canonicalize(file).unwrap())));
    assert!(restored_paths.contains(&(EntryKind::Directory, disk::canonicalize(folder).unwrap())));
}
