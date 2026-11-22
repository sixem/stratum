// A byte callback may already report the full file size before the executor
// confirms success. Repeating it must leave the completed-file count alone.
use super::*;
use crate::domain::filesystem::CompletedFileWork;

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
        runtime.update_snapshot(&mut snapshot, &last_byte_update);
        assert_eq!(snapshot.work.files_completed, 0);
        assert_eq!(snapshot.work.bytes_completed, 12);
    }
    runtime.update_snapshot(
        &mut snapshot,
        &fs::TransferProgressUpdate {
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
    runtime.update_snapshot(&mut snapshot, &empty_file_start);
    assert_eq!(snapshot.work.files_completed, 1);
    runtime.update_snapshot(
        &mut snapshot,
        &fs::TransferProgressUpdate {
            completed_file_work: Some(CompletedFileWork { files: 1, bytes: 0 }),
            ..empty_file_start
        },
    );
    assert_eq!(snapshot.work.files_completed, 2);
    assert_eq!(snapshot.work.bytes_completed, 12);
}
