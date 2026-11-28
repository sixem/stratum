// Exercise the Work entry points over two independent OpenSSH subsystem sessions.
use super::*;
use crate::services::{
    operation_events::{
        testing::Observed, DeleteMethod, ItemChange, Location, OperationEvents, TransferCounts,
        TransferOutcome,
    },
    remotes::{
        operations,
        recovery::{recover_active, test_journal},
    },
    transfer_manager::TransferManagerHandle,
};
use std::{sync::Arc, time::Duration};

fn batch(
    manager: &TransferManagerHandle,
    id: &str,
    items: Vec<Transfer>,
    decision: preflight::Decision,
) -> BatchResult {
    manager
        .remote_batch_fixture(
            TransferBatch {
                items,
                _drop_stage: None,
                request_decision: Arc::new(move |_| {
                    Ok(preflight::PendingDecision::fixture(decision))
                }),
                item_finished: Arc::new(|_| {}),
            },
            id,
        )
        .recv_timeout(Duration::from_secs(30))
        .unwrap()
        .unwrap()
}

fn selected(name: &str, directory: bool) -> operations::SelectedEntry {
    serde_json::from_value(serde_json::json!({"name":name, "isDir":directory, "isSymlink":false}))
        .unwrap()
}

#[test]
#[ignore = "requires the disposable SFTP operations folder"]
fn queued_transfers_report_verified_roots_across_local_and_remote_locations() {
    tauri::async_runtime::block_on(async {
        let remotes = Remotes::default();
        let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
        let base = std::env::var("STRATUM_SFTP_OPERATIONS_DIR").unwrap();
        let connect = |profile| remotes.connect(profile, &host, &base, Arc::new(|_| {}));
        let a = connect("left-profile").await.unwrap().session_id;
        let b = connect("right-profile").await.unwrap().session_id;
        let name = format!("stratum-events-{}", uuid::Uuid::new_v4());
        let local = std::env::temp_dir().join(&name);
        let remote = format!("{base}/{name}");
        let other = format!("{remote}/other");
        fs::create_dir(&local).unwrap();
        let journal = test_journal(&local.join("journal.sqlite"));
        let events = OperationEvents::default();
        let mut observed = Observed::subscribe(&events);
        let manager = TransferManagerHandle::with_events(events.clone());
        let left = |path: &str| Location::sftp("left-profile", path);
        let right = |path: &str| Location::sftp("right-profile", path);
        let job = |profile: &str, session, direction, moving| Transfer {
            remotes: remotes.clone(),
            profile: profile.into(),
            session,
            direction,
            moving,
            recovery: Some(journal.clone()),
            replace: false,
            expected: None,
            source_changed: None,
        };
        let upload = |path: &Path, moving| {
            job(
                "left-profile",
                a,
                Direction::Upload {
                    local_path: path.into(),
                    remote_folder: remote.clone(),
                },
                moving,
            )
        };
        let skip = preflight::Decision::Skip;

        operations::create(&events, &remotes, "left-profile", a, &base, &name, true)
            .await
            .unwrap();
        observed.item(
            None,
            EntryKind::Directory,
            ItemChange::Created {
                destination: left(&remote),
            },
        );
        let original_folder = format!("{remote}/old-folder");
        tree::remote_mkdir(
            &remotes.current("left-profile", Some(a)).unwrap(),
            &original_folder,
        )
        .await
        .unwrap();
        let filename = " report é.txt";
        let original = format!("{remote}/{filename}");
        let renamed = format!("{remote}/Renamed.txt");
        crate::services::webhooks::tests::check_sftp_creation(
            &events,
            "left-profile",
            &original,
            operations::create(
                &events,
                &remotes,
                "left-profile",
                a,
                &remote,
                filename,
                false,
            ),
        )
        .await;
        assert!(operations::create(
            &events,
            &remotes,
            "left-profile",
            a,
            &remote,
            filename,
            false
        )
        .await
        .is_err());
        operations::rename_entry(
            &events,
            Some("rename-selection"),
            &remotes,
            "left-profile",
            a,
            &remote,
            &selected(filename, false),
            "Renamed.txt",
        )
        .await
        .unwrap();
        operations::rename_entry(
            &events,
            Some("rename-selection"),
            &remotes,
            "left-profile",
            a,
            &remote,
            &selected("old-folder", true),
            "other",
        )
        .await
        .unwrap();
        observed.item(
            None,
            EntryKind::File,
            ItemChange::Created {
                destination: left(&original),
            },
        );
        observed.item(
            Some("rename-selection"),
            EntryKind::File,
            ItemChange::Renamed {
                source: left(&original),
                destination: left(&renamed),
            },
        );
        observed.item(
            Some("rename-selection"),
            EntryKind::Directory,
            ItemChange::Renamed {
                source: left(&original_folder),
                destination: left(&other),
            },
        );
        observed.empty();

        let tree = local.join("tree");
        fs::create_dir(&tree).unwrap();
        fs::write(tree.join("child"), b"data").unwrap();
        let uploaded = format!("{remote}/tree");
        batch(
            &manager,
            "upload",
            vec![upload(&tree, false), upload(&local.join("missing"), false)],
            skip,
        );
        observed.item(
            Some("upload"),
            EntryKind::Directory,
            ItemChange::Copied {
                source: Location::Local(tree.clone()),
                destination: left(&uploaded),
            },
        );
        observed.terminal(
            "upload",
            TransferOutcome::Failed,
            TransferCounts {
                copied: 1,
                failed: 1,
                ..Default::default()
            },
        );
        batch(&manager, "skip", vec![upload(&tree, false)], skip);
        observed.terminal(
            "skip",
            TransferOutcome::Completed,
            TransferCounts {
                skipped: 1,
                ..Default::default()
            },
        );
        let replaced = batch(
            &manager,
            "replace",
            vec![upload(&tree, false)],
            preflight::Decision::Replace,
        );
        assert!(replaced.items[0].result.as_ref().unwrap().backup.is_some());
        observed.item(
            Some("replace"),
            EntryKind::Directory,
            ItemChange::Copied {
                source: Location::Local(tree),
                destination: left(&uploaded),
            },
        );
        observed.terminal(
            "replace",
            TransferOutcome::Completed,
            TransferCounts {
                copied: 1,
                ..Default::default()
            },
        );

        let cross = |source: &str, moving| {
            job(
                "left-profile",
                a,
                Direction::Remote {
                    remote_path: source.into(),
                    dest_profile: "right-profile".into(),
                    dest_session: b,
                    remote_folder: other.clone(),
                },
                moving,
            )
        };
        let copied = format!("{other}/tree");
        batch(&manager, "cross-copy", vec![cross(&uploaded, false)], skip);
        observed.item(
            Some("cross-copy"),
            EntryKind::Directory,
            ItemChange::Copied {
                source: left(&uploaded),
                destination: right(&copied),
            },
        );
        observed.terminal(
            "cross-copy",
            TransferOutcome::Completed,
            TransferCounts {
                copied: 1,
                ..Default::default()
            },
        );
        let moved = format!("{other}/Renamed.txt");
        batch(&manager, "cross-move", vec![cross(&renamed, true)], skip);
        observed.item(
            Some("cross-move"),
            EntryKind::File,
            ItemChange::Moved {
                source: left(&renamed),
                destination: right(&moved),
            },
        );
        observed.terminal(
            "cross-move",
            TransferOutcome::Completed,
            TransferCounts {
                moved: 1,
                ..Default::default()
            },
        );

        let out = local.join("out");
        fs::create_dir(&out).unwrap();
        let download = |path: &str, moving| {
            job(
                "right-profile",
                b,
                Direction::Download {
                    remote_path: path.into(),
                    local_folder: out.clone(),
                },
                moving,
            )
        };
        batch(&manager, "download", vec![download(&moved, false)], skip);
        observed.item(
            Some("download"),
            EntryKind::File,
            ItemChange::Copied {
                source: right(&moved),
                destination: Location::Local(out.join("Renamed.txt")),
            },
        );
        observed.terminal(
            "download",
            TransferOutcome::Completed,
            TransferCounts {
                copied: 1,
                ..Default::default()
            },
        );
        batch(
            &manager,
            "download-move",
            vec![download(&copied, true)],
            skip,
        );
        assert_eq!(fs::read(out.join("tree/child")).unwrap(), b"data");
        observed.item(
            Some("download-move"),
            EntryKind::Directory,
            ItemChange::Moved {
                source: right(&copied),
                destination: Location::Local(out.join("tree")),
            },
        );
        observed.terminal(
            "download-move",
            TransferOutcome::Completed,
            TransferCounts {
                moved: 1,
                ..Default::default()
            },
        );

        let file = local.join("move.txt");
        fs::write(&file, b"move").unwrap();
        batch(&manager, "upload-move", vec![upload(&file, true)], skip);
        let source = format!("{remote}/move.txt");
        observed.item(
            Some("upload-move"),
            EntryKind::File,
            ItemChange::Moved {
                source: Location::Local(file.clone()),
                destination: left(&source),
            },
        );
        observed.terminal(
            "upload-move",
            TransferOutcome::Completed,
            TransferCounts {
                moved: 1,
                ..Default::default()
            },
        );
        assert!(!file.exists());

        // Disconnect precisely after the original enters its journalled staging folder.
        let session = remotes.current("left-profile", Some(a)).unwrap();
        let mut interrupted = cross(&source, true);
        interrupted.source_changed = Some(Arc::new(move |_| {
            session.stop.send_replace(true);
        }));
        let partial = batch(&manager, "interrupted", vec![interrupted], skip);
        assert!(partial.items[0].error.is_some());
        observed.terminal(
            "interrupted",
            TransferOutcome::Failed,
            TransferCounts {
                failed: 1,
                ..Default::default()
            },
        );
        remotes.disconnect("left-profile").await;
        let a = connect("left-profile").await.unwrap().session_id;
        let record = journal.list().unwrap().pop().unwrap();
        recover_active(&remotes, &journal, &record.id, "left-profile", a)
            .await
            .unwrap();
        assert!(remotes.exists("left-profile", a, &source).await.unwrap());
        observed.empty();

        let deletion = operations::RemoteDelete {
            remotes: remotes.clone(),
            profile: "left-profile".into(),
            session: a,
            parent: base.clone(),
            entries: vec![selected(&name, true)],
            journal,
            source_changed: Arc::new(|_| {}),
        };
        let deleted = manager
            .remote_delete_fixture(deletion)
            .recv_timeout(Duration::from_secs(30))
            .unwrap()
            .unwrap();
        assert_eq!(deleted.deleted, 1, "{:?}", deleted.failures);
        observed.item(
            Some("fixture-delete"),
            EntryKind::Directory,
            ItemChange::Deleted {
                source: left(&remote),
                method: DeleteMethod::Permanent,
            },
        );
        observed.empty();
        remotes.disconnect("left-profile").await;
        remotes.disconnect("right-profile").await;
        fs::remove_dir_all(local).unwrap();
    });
}
