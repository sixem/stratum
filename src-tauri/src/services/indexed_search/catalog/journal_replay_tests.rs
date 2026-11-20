// Exercise production reconciliation with a temporary physical root and a
// separate SQLite catalog. Mount verification is injected at this boundary.
use std::cell::Cell;

use super::*;
use crate::services::indexed_search::{
    journal_batch::{JournalBatch, JournalChangeKind, JournalPathChange},
    reconcile::{reconcile_journal_batch, ReconcileOutcome},
    volume_tracking::VolumeMount,
};
use JournalChangeKind::{Path as ChangedPath, RenameNew, RenameOld};

const ROOT_ID: u64 = 5;

struct Fixture {
    directory: TestDirectory,
    catalog: IndexedCatalogStore,
    mount: VolumeMount,
}

impl Fixture {
    fn new(names: &[&str]) -> Self {
        let directory = TestDirectory::new();
        let root = directory.0.join("volume");
        fs::create_dir(&root).unwrap();
        let catalog = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
        let mut initial = catalog.begin_drive_refresh(DRIVE).unwrap();
        initial
            .insert_batch(&names.iter().map(|name| record(name)).collect::<Vec<_>>())
            .unwrap();
        initial
            .finish_drive_refresh(DRIVE, "baseline", 1, VOLUME_ID, Some(CHECKPOINT), || Ok(()))
            .unwrap();
        Self {
            directory,
            catalog,
            mount: VolumeMount {
                drive_path: DRIVE.into(),
                identity: VOLUME_ID.into(),
                guid: root.to_str().unwrap().into(),
            },
        }
    }

    fn reopen(&mut self) {
        self.catalog = IndexedCatalogStore::open(self.directory.0.join("catalog.db")).unwrap();
    }

    fn apply(&self, batch: JournalBatch) -> ReconcileOutcome {
        reconcile_journal_batch(&self.catalog, &self.mount, batch, &|| false, &|| Ok(())).unwrap()
    }

    fn assert_state(&self, usn: i64, paths: &[&str], pending: bool) {
        assert_ready_snapshot(
            &self.catalog,
            paths.len(),
            "baseline",
            VOLUME_ID,
            Some(checkpoint(usn)),
        );
        assert_eq!(installed_paths(&self.catalog), paths);
        let snapshot = self
            .catalog
            .load_ready_drive_snapshots()
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(snapshot.pending_renames, pending);
    }
}

fn checkpoint(usn: i64) -> JournalCheckpoint {
    JournalCheckpoint {
        next_usn: usn,
        ..CHECKPOINT
    }
}

fn batch(
    start: i64,
    end: i64,
    has_more: bool,
    changes: &[(JournalChangeKind, u64, &str)],
) -> JournalBatch {
    JournalBatch {
        previous: checkpoint(start),
        next: checkpoint(end),
        has_more,
        changes: changes
            .iter()
            .map(|&(kind, parent_file_id, path)| JournalPathChange {
                kind,
                parent_file_id,
                path: path.into(),
            })
            .collect(),
    }
}

fn assert_committed(outcome: ReconcileOutcome, paths: bool, pending: bool) {
    let ReconcileOutcome::Committed {
        changed_paths,
        pending_renames,
    } = outcome
    else {
        panic!("expected a committed journal batch")
    };
    assert_eq!((changed_paths, pending_renames), (paths, pending));
}

#[test]
fn interleaved_rename_pairs_resume_after_reopen_and_cancel() {
    let mut fixture = Fixture::new(&["alpha", "beta"]);
    for name in ["renamed-alpha", "renamed-beta"] {
        fs::write(PathBuf::from(&fixture.mount.guid).join(name), []).unwrap();
    }
    let alpha = u64::MAX;
    let beta = 8;
    let first = batch(
        CHECKPOINT.next_usn,
        200,
        true,
        &[(RenameOld(alpha), ROOT_ID, r"C:\alpha")],
    );
    assert_committed(fixture.apply(first), false, true);
    assert_committed(
        fixture.apply(batch(
            200,
            300,
            true,
            &[(RenameOld(beta), ROOT_ID, r"C:\beta")],
        )),
        false,
        true,
    );
    fixture.reopen();
    fixture.assert_state(300, &[r"C:\alpha", r"C:\beta"], true);

    assert_committed(
        fixture.apply(batch(
            300,
            400,
            true,
            &[(RenameNew(beta), ROOT_ID, r"C:\renamed-beta")],
        )),
        true,
        true,
    );
    let last = || {
        batch(
            400,
            500,
            false,
            &[(RenameNew(alpha), ROOT_ID, r"C:\renamed-alpha")],
        )
    };
    let verifications = Cell::new(0);
    let cancelled = reconcile_journal_batch(
        &fixture.catalog,
        &fixture.mount,
        last(),
        &|| verifications.get() == 2,
        &|| {
            verifications.set(verifications.get() + 1);
            Ok(())
        },
    )
    .unwrap();
    assert!(matches!(cancelled, ReconcileOutcome::Cancelled));
    fixture.reopen();
    fixture.assert_state(400, &[r"C:\alpha", r"C:\renamed-beta"], true);

    assert_committed(fixture.apply(last()), true, false);
    fixture.assert_state(500, &[r"C:\renamed-alpha", r"C:\renamed-beta"], false);
}

#[test]
fn split_case_only_rename_survives_rollback_until_rebuild_commits() {
    let mut fixture = Fixture::new(&["Report"]);
    let old = batch(
        CHECKPOINT.next_usn,
        200,
        true,
        &[(RenameOld(42), ROOT_ID, r"C:\Report")],
    );
    assert_committed(fixture.apply(old), false, true);
    fixture.reopen();
    let new = || batch(200, 300, false, &[(RenameNew(42), ROOT_ID, r"C:\REPORT")]);
    assert!(matches!(
        fixture.apply(new()),
        ReconcileOutcome::NeedsRebuild
    ));
    fixture.assert_state(200, &[r"C:\Report"], true);

    let cancelled = fixture.catalog.begin_drive_refresh(DRIVE).unwrap();
    assert!(cancelled
        .finish_drive_refresh(
            DRIVE,
            "recovery",
            2,
            VOLUME_ID,
            Some(checkpoint(300)),
            || Err("cancelled".into())
        )
        .is_err());
    fixture.reopen();
    assert!(matches!(
        fixture.apply(new()),
        ReconcileOutcome::NeedsRebuild
    ));
    fixture.assert_state(200, &[r"C:\Report"], true);

    let mut replacement = fixture.catalog.begin_drive_refresh(DRIVE).unwrap();
    replacement.insert_batch(&[record("REPORT")]).unwrap();
    replacement
        .finish_drive_refresh(
            DRIVE,
            "recovery",
            2,
            VOLUME_ID,
            Some(checkpoint(300)),
            || Ok(()),
        )
        .unwrap();
    assert_ready_snapshot(
        &fixture.catalog,
        1,
        "recovery",
        VOLUME_ID,
        Some(checkpoint(300)),
    );
    assert_eq!(installed_paths(&fixture.catalog), [r"C:\REPORT"]);
    assert!(!fixture.catalog.has_pending_renames(DRIVE).unwrap());
}

#[test]
fn parent_identity_distinguishes_a_case_only_rename_from_a_move() {
    let mut fixture = Fixture::new(&[r"before\blå"]);
    let original = r"C:\before\blå";
    let destination = r"C:\after\BLÅ";
    let physical = PathBuf::from(&fixture.mount.guid).join(&destination[3..]);
    fs::create_dir_all(physical.parent().unwrap()).unwrap();
    fs::write(physical, []).unwrap();

    let parent_id = u64::MAX;
    let old = batch(
        CHECKPOINT.next_usn,
        200,
        true,
        &[(RenameOld(42), parent_id, original)],
    );
    assert_committed(fixture.apply(old), false, true);
    fixture.reopen();
    let new = |parent| batch(200, 300, false, &[(RenameNew(42), parent, destination)]);

    // Two spellings in one directory remain ambiguous after its path changes.
    assert!(matches!(
        fixture.apply(new(parent_id)),
        ReconcileOutcome::NeedsRebuild
    ));
    fixture.assert_state(200, &[original], true);

    // The same projected paths represent a valid move when the parents differ.
    assert_committed(fixture.apply(new(99)), true, false);
    fixture.assert_state(300, &[destination], false);
}

#[test]
fn small_excluded_batch_commits_a_partial_cursor() {
    let fixture = Fixture::new(&[]);
    let wal = fixture.directory.0.join("catalog.db-wal");
    let noise = [(ChangedPath, ROOT_ID, wal.to_str().unwrap())];
    let partial = batch(CHECKPOINT.next_usn, 200, true, &noise);
    assert_committed(fixture.apply(partial), false, false);
    assert!(matches!(
        fixture.apply(batch(200, 300, false, &noise)),
        ReconcileOutcome::Unchanged
    ));
    fixture.assert_state(200, &[], false);
}

#[test]
fn idle_journal_checks_leave_the_catalog_closed() {
    let fixture = Fixture::new(&[]);
    let database = fixture.directory.0.join("unopened.db");
    let catalog = IndexedCatalogStore::new(database.clone());
    let noise = [(ChangedPath, ROOT_ID, database.to_str().unwrap())];
    for idle in [batch(200, 200, false, &[]), batch(200, 300, false, &noise)] {
        let outcome =
            reconcile_journal_batch(&catalog, &fixture.mount, idle, &|| false, &|| Ok(())).unwrap();
        assert!(matches!(outcome, ReconcileOutcome::Unchanged));
        assert!(!database.exists());
    }
}
