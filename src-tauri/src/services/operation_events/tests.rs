use super::*;
use broadcast::error::TryRecvError;

fn local(path: &str) -> Location {
    Location::Local(std::env::temp_dir().join(path))
}

fn sftp(host: &str, path: &str) -> Location {
    Location::Sftp {
        host_id: host.into(),
        path: path.into(),
    }
}

#[test]
fn a_partial_batch_reports_only_committed_roots_then_the_work_outcome() {
    let events = OperationEvents::default();
    let mut receiver = events.subscribe();
    let before = SystemTime::now();
    let folder = local("source/tree");
    let file = local("source/image");
    let selected = [
        folder.clone(),
        file.clone(),
        local("skipped"),
        local("failed"),
        folder.clone(),
    ];
    let mut op = events.operation(Some("work-17"), Origin::User, selected.iter().cloned());
    let final_folder = sftp("archive", "/incoming/tree (2)");
    let final_file = sftp("archive", "/incoming/image");

    // A recursive copy touches this child but only the selected folder is a reportable root.
    op.item_succeeded(&local("source/tree/child"), EntryKind::File, || {
        panic!("descendant")
    });
    op.item_succeeded(&folder, EntryKind::Directory, || ItemSuccess::Copied {
        destination: final_folder.clone(),
    });
    op.item_succeeded(&folder, EntryKind::Directory, || panic!("duplicate root"));
    op.item_succeeded(&file, EntryKind::File, || ItemSuccess::Copied {
        destination: final_file.clone(),
    });
    let counts = TransferCounts {
        copied: 2,
        moved: 0,
        skipped: 1,
        failed: 1,
    };
    op.finish_transfer(TransferOutcome::Failed, counts);

    let batch = [
        receiver.try_recv().unwrap(),
        receiver.try_recv().unwrap(),
        receiver.try_recv().unwrap(),
    ];
    assert_eq!(
        batch.each_ref().map(|event| event.name()),
        ["directory.copied", "file.copied", "transfer.failed"]
    );
    assert!(
        matches!(&batch[0].details, EventDetails::Item { change: ItemChange::Copied { source, destination }, .. }
        if *source == folder && *destination == final_folder)
    );
    assert!(
        matches!(&batch[1].details, EventDetails::Item { change: ItemChange::Copied { source, destination }, .. }
        if *source == file && *destination == final_file)
    );
    assert!(
        matches!(&batch[2].details, EventDetails::Transfer { counts: actual, .. } if *actual == counts)
    );
    let after = SystemTime::now();
    assert!(batch.iter().all(|e| e.operation_id == "work-17"
        && e.origin == Origin::User
        && (before..=after).contains(&e.timestamp)));
    assert_eq!(batch.iter().map(|e| e.id).collect::<HashSet<_>>().len(), 3);
    assert_eq!(receiver.try_recv().unwrap_err(), TryRecvError::Empty);
}

#[test]
fn relocation_uses_the_actual_parent_and_endpoint_and_preserves_original_spelling() {
    let events = OperationEvents::default();
    let mut receiver = events.subscribe();
    for (source, destination, expected) in [
        (
            local("parent/name"),
            local("parent/Name"),
            Some("file.renamed"),
        ),
        (local("a/name"), local("b/new"), Some("file.moved")),
        (
            sftp("a", "/name"),
            sftp("a", r"/ New\name "),
            Some("file.renamed"),
        ),
        (
            sftp("a", "/Data/x"),
            sftp("a", "/data/y"),
            Some("file.moved"),
        ),
        (
            sftp("a", "/data/x"),
            sftp("b", "/data/x"),
            Some("file.moved"),
        ),
        (sftp("a", "/data/x"), local("data/x"), Some("file.moved")),
        (local("data/x"), sftp("a", "/data/x"), Some("file.moved")),
        (sftp("a", "/name"), sftp("a", "/name"), None),
        (local("same/name"), local("same/name"), None),
    ] {
        let mut op = events.operation(None, Origin::Rule, [source.clone()]);
        op.item_succeeded(&source, EntryKind::File, || ItemSuccess::Relocated {
            destination: destination.clone(),
        });
        if let Some(name) = expected {
            let event = receiver.try_recv().unwrap();
            assert_eq!(event.name(), name);
            assert_eq!(event.origin, Origin::Rule);
            assert!(matches!(&event.details,
                EventDetails::Item { change: ItemChange::Renamed { source: a, destination: b } |
                    ItemChange::Moved { source: a, destination: b }, .. } if *a == source && *b == destination));
        }
        assert_eq!(receiver.try_recv().unwrap_err(), TryRecvError::Empty);
    }
}

#[test]
fn item_contract_covers_both_kinds_and_distinguishes_delete_methods() {
    let events = OperationEvents::default();
    let mut receiver = events.subscribe();
    for (kind, prefix) in [
        (EntryKind::File, "file"),
        (EntryKind::Directory, "directory"),
    ] {
        let root = local("a/name");
        let copied = local("b/final name");
        let renamed = local("a/new name");
        for (suffix, outcome, expected) in [
            (
                "created",
                ItemSuccess::Created {
                    destination: root.clone(),
                },
                ItemChange::Created {
                    destination: root.clone(),
                },
            ),
            (
                "copied",
                ItemSuccess::Copied {
                    destination: copied.clone(),
                },
                ItemChange::Copied {
                    source: root.clone(),
                    destination: copied.clone(),
                },
            ),
            (
                "moved",
                ItemSuccess::Relocated {
                    destination: copied.clone(),
                },
                ItemChange::Moved {
                    source: root.clone(),
                    destination: copied.clone(),
                },
            ),
            (
                "renamed",
                ItemSuccess::Relocated {
                    destination: renamed.clone(),
                },
                ItemChange::Renamed {
                    source: root.clone(),
                    destination: renamed,
                },
            ),
            (
                "deleted",
                ItemSuccess::Deleted(DeleteMethod::Permanent),
                ItemChange::Deleted {
                    source: root.clone(),
                    method: DeleteMethod::Permanent,
                },
            ),
            (
                "deleted",
                ItemSuccess::Deleted(DeleteMethod::RecycleBin),
                ItemChange::Deleted {
                    source: root.clone(),
                    method: DeleteMethod::RecycleBin,
                },
            ),
        ] {
            let mut op = events.operation(None, Origin::User, [root.clone()]);
            op.item_succeeded(&root, kind, || outcome);
            let event = receiver.try_recv().unwrap();
            assert_eq!(event.name(), format!("{prefix}.{suffix}"));
            assert!(
                matches!(&event.details, EventDetails::Item { change, .. } if *change == expected)
            );
            assert_eq!(receiver.try_recv().unwrap_err(), TryRecvError::Empty);
        }
    }
    let remote = sftp("configured-host", "/tree");
    for method in [DeleteMethod::Permanent, DeleteMethod::RecycleBin] {
        let mut op = events.operation(None, Origin::User, [remote.clone()]);
        op.item_succeeded(&remote, EntryKind::Directory, || {
            ItemSuccess::Deleted(method)
        });
        if method == DeleteMethod::Permanent {
            let event = receiver.try_recv().unwrap();
            assert!(
                matches!(&event.details, EventDetails::Item { change: ItemChange::Deleted { source, method: DeleteMethod::Permanent }, .. } if *source == remote)
            );
        }
        assert_eq!(receiver.try_recv().unwrap_err(), TryRecvError::Empty);
    }
}

#[test]
fn terminal_outcomes_share_the_operation_id_and_subscribers_receive_the_same_event() {
    let events = OperationEvents::default();
    let mut first = events.subscribe();
    let mut second = events.subscribe();
    let root = sftp("alpha", "/folder");
    let mut ids = HashSet::new();
    for (outcome, expected) in [
        (TransferOutcome::Cancelled, "transfer.cancelled"),
        (TransferOutcome::Completed, "transfer.completed"),
    ] {
        let mut op = events.operation(None, Origin::User, [root.clone()]);
        op.item_succeeded(&root, EntryKind::Directory, || ItemSuccess::Relocated {
            destination: sftp("other", "/folder"),
        });
        op.finish_transfer(
            outcome,
            TransferCounts {
                moved: 1,
                ..Default::default()
            },
        );
        let item = first.try_recv().unwrap();
        let terminal = first.try_recv().unwrap();
        assert_eq!(terminal.name(), expected);
        assert!(Arc::ptr_eq(&item, &second.try_recv().unwrap()));
        assert!(Arc::ptr_eq(&terminal, &second.try_recv().unwrap()));
        assert_eq!(item.operation_id, terminal.operation_id);
        assert!(
            Uuid::parse_str(&item.operation_id).is_ok() && ids.insert(item.operation_id.clone())
        );
        assert_ne!(item.id, terminal.id);
    }
}

#[test]
fn idle_dispatch_does_not_build_events_and_subscriptions_do_not_replay() {
    let events = OperationEvents::default();
    let root = local("one");
    let report = || events.operation(None, Origin::User, [root.clone()]);
    let idle = || {
        let roots = std::iter::once_with(|| panic!("traversed idle selection"));
        let mut op = events.operation(None, Origin::User, roots);
        op.item_succeeded(&root, EntryKind::File, || {
            panic!("constructed unused payload")
        });
        assert!(op.remaining.is_none() && op.id.is_none());
        op.finish_transfer(TransferOutcome::Completed, Default::default());
    };
    idle();
    assert!(events.channel.get().is_none());
    let mut receiver = events.subscribe();
    assert_eq!(receiver.try_recv().unwrap_err(), TryRecvError::Empty);
    report().finish_transfer(TransferOutcome::Completed, Default::default());
    let mut later = events.subscribe();
    assert_eq!(later.try_recv().unwrap_err(), TryRecvError::Empty);
    assert_eq!(receiver.try_recv().unwrap().name(), "transfer.completed");
    drop(receiver);
    drop(later);
    idle();
}

#[test]
fn slow_receivers_can_observe_lag_without_blocking_producers() {
    let events = OperationEvents::default();
    let mut receiver = events.subscribe();
    for _ in 0..=CHANNEL_CAPACITY {
        events
            .operation(Some("job"), Origin::User, [])
            .finish_transfer(TransferOutcome::Completed, Default::default());
    }
    assert_eq!(receiver.try_recv().unwrap_err(), TryRecvError::Lagged(1));
    assert_eq!(receiver.try_recv().unwrap().name(), "transfer.completed");
}
