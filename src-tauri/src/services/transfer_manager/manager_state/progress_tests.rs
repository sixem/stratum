// A byte callback may already report the full file size before the executor
// confirms success. Repeating it must leave the completed-file count alone.
use super::*;
use crate::domain::filesystem::{CompletedFileWork, CompletedTransferItem};

fn apply(
    runtime: &mut ActiveTransferRuntimeProgress,
    snapshot: &mut TransferJobSnapshot,
    update: fs::TransferProgressUpdate,
) {
    let mut batch = TransferProgressBatch::default();
    batch.push(update);
    runtime.update_snapshot(snapshot, &batch);
}

#[test]
fn counts_only_confirmed_file_work_including_empty_files() {
    let mut runtime = ActiveTransferRuntimeProgress {
        progress_kind: Some(TransferProgressKind::Files),
        ..Default::default()
    };
    let mut snapshot = build_initial_snapshot(
        &AtomicU64::new(0),
        Some("copy"),
        2,
        TransferJobDescriptor {
            kind: TransferJobKind::Copy,
            capabilities: TransferJobCapabilities {
                can_pause: true,
                can_cancel: true,
            },
        },
    );
    snapshot.work.files_total = Some(2);
    snapshot.work.bytes_total = Some(12);

    let last_byte_update = fs::TransferProgressUpdate {
        current_bytes: Some(12),
        current_total_bytes: Some(12),
        ..Default::default()
    };
    for _ in 0..2 {
        apply(&mut runtime, &mut snapshot, last_byte_update.clone());
        assert_eq!(snapshot.work.files_completed, 0);
        assert_eq!(snapshot.work.bytes_completed, 12);
    }
    apply(
        &mut runtime,
        &mut snapshot,
        fs::TransferProgressUpdate {
            completed_file_work: Some(CompletedFileWork {
                files: 1,
                bytes: 12,
            }),
            ..last_byte_update
        },
    );
    assert_eq!(snapshot.work.files_completed, 1);
    assert_eq!(snapshot.work.bytes_completed, 12);

    let empty_file_start = fs::TransferProgressUpdate {
        current_path: Some("empty.txt".into()),
        current_bytes: Some(0),
        current_total_bytes: Some(0),
        ..Default::default()
    };
    apply(&mut runtime, &mut snapshot, empty_file_start.clone());
    assert_eq!(snapshot.work.files_completed, 1);
    apply(
        &mut runtime,
        &mut snapshot,
        fs::TransferProgressUpdate {
            completed_file_work: Some(CompletedFileWork { files: 1, bytes: 0 }),
            ..empty_file_start
        },
    );
    assert_eq!(snapshot.work.files_completed, 2);
    assert_eq!(snapshot.work.bytes_completed, 12);
}

#[test]
fn a_large_directory_batch_keeps_every_file_delta_and_the_current_path() {
    let mut runtime = ActiveTransferRuntimeProgress {
        progress_kind: Some(TransferProgressKind::Files),
        ..Default::default()
    };
    let mut snapshot = build_initial_snapshot(
        &AtomicU64::new(0),
        Some("copy"),
        2,
        TransferJobDescriptor {
            kind: TransferJobKind::Copy,
            capabilities: TransferJobCapabilities {
                can_pause: true,
                can_cancel: true,
            },
        },
    );
    snapshot.work.files_total = Some(10_001);
    snapshot.work.bytes_total = Some(60_005);
    let mut batch = TransferProgressBatch::default();
    for index in 0..10_000 {
        batch.push(fs::TransferProgressUpdate {
            current_path: Some(format!("folder\\{index}.bin")),
            current_bytes: Some(0),
            current_total_bytes: Some(6),
            ..Default::default()
        });
        batch.push(fs::TransferProgressUpdate {
            current_bytes: Some(6),
            current_total_bytes: Some(6),
            completed_file_work: Some(CompletedFileWork { files: 1, bytes: 6 }),
            ..Default::default()
        });
    }
    batch.push(fs::TransferProgressUpdate {
        processed: 1,
        completed_item: Some(CompletedTransferItem {
            path: "folder".into(),
            source_removed: false,
        }),
        ..Default::default()
    });
    batch.push(fs::TransferProgressUpdate {
        current_path: Some("next.bin".into()),
        current_bytes: Some(0),
        current_total_bytes: Some(5),
        ..Default::default()
    });
    batch.push(fs::TransferProgressUpdate {
        current_bytes: Some(3),
        current_total_bytes: Some(5),
        ..Default::default()
    });
    runtime.update_snapshot(&mut snapshot, &batch);
    assert_eq!(snapshot.work.files_completed, 10_000);
    assert_eq!(snapshot.work.bytes_completed, 60_003);
    assert_eq!(batch.latest.current_path.as_deref(), Some("next.bin"));
    assert_eq!(batch.latest.current_bytes, Some(3));
    assert_eq!(batch.completed_items.len(), 1);
    assert_eq!(batch.completed_items[0].path, "folder");
}
