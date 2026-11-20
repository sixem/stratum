// Regression coverage for the connection boundary around a drive rebuild.
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::domain::indexed_search::IndexedPathQuery;

use super::*;

#[path = "journal_replay_tests.rs"]
mod journal_replay_tests;

const DRIVE: &str = r"C:\";
const VOLUME_ID: &str = "volume-c";
const CHECKPOINT: JournalCheckpoint = JournalCheckpoint {
    journal_id: u64::MAX,
    next_usn: 123,
};

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        // Parallel tests can observe the same Windows clock tick.
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let directory = std::env::temp_dir().join(format!(
            "stratum-atomic-rebuild-test-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        fs::create_dir(&directory).expect("create test directory");
        Self(directory)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn record(name: &str) -> CatalogEntryRecord {
    CatalogEntryRecord::new(
        format!("{DRIVE}{name}"),
        name.to_string(),
        IndexedEntryKind::File,
    )
}

fn search(catalog: &IndexedCatalogStore, query: &str, volumes: &[(&str, &str)]) -> Vec<String> {
    let scope = volumes
        .iter()
        .map(|(drive, id)| (drive.to_string(), id.to_string()))
        .collect::<Vec<_>>();
    catalog
        .query(
            IndexedPathQuery {
                query: query.to_string(),
                limit: Some(1),
            },
            &scope,
        )
        .expect("search catalog")
        .into_iter()
        .map(|entry| entry.path)
        .collect()
}

fn assert_ready_snapshot(
    catalog: &IndexedCatalogStore,
    expected_count: usize,
    expected_source: &str,
    expected_volume: &str,
    expected_checkpoint: Option<JournalCheckpoint>,
) {
    let snapshots = catalog
        .load_ready_drive_snapshots()
        .expect("load ready drives");
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].drive_path, DRIVE);
    assert_eq!(snapshots[0].volume_id.as_deref(), Some(expected_volume));
    assert_eq!(snapshots[0].journal_checkpoint, expected_checkpoint);
    assert_eq!(
        catalog.read_ready_drive_count(&snapshots[0]).unwrap(),
        Some(expected_count)
    );
    assert_eq!(
        snapshots[0].last_scan_source.as_deref(),
        Some(expected_source)
    );
}

#[test]
fn drive_rebuild_keeps_previous_snapshot_until_commit() {
    let test_directory = TestDirectory::new();
    let catalog =
        IndexedCatalogStore::open(test_directory.0.join("catalog.db")).expect("open test catalog");

    let mut initial = catalog
        .begin_drive_refresh(DRIVE)
        .expect("start initial rebuild");
    let mut original = record("original.txt");
    original.path.replace_range(..1, "c");
    initial
        .insert_batch(&[original])
        .expect("index initial file");
    initial
        .finish_drive_refresh(DRIVE, "original", 1, VOLUME_ID, Some(CHECKPOINT), || Ok(()))
        .expect("publish initial snapshot");

    let mut cancelled = catalog
        .begin_drive_refresh(DRIVE)
        .expect("start cancelled rebuild");
    cancelled
        .insert_batch(&[record("replacement-one.txt")])
        .expect("index first batch");
    cancelled
        .insert_batch(&[record("replacement-two.txt")])
        .expect("index second batch");
    assert_eq!(
        search(&catalog, "original", &[(DRIVE, VOLUME_ID)]),
        [r"c:\original.txt"]
    );
    assert!(search(&catalog, "replacement", &[(DRIVE, VOLUME_ID)]).is_empty());
    assert_ready_snapshot(&catalog, 1, "original", VOLUME_ID, Some(CHECKPOINT));

    let result = cancelled.finish_drive_refresh(DRIVE, "cancelled", 2, "new-volume", None, || {
        Err("cancelled".to_string())
    });
    assert_eq!(result, Err("cancelled".to_string()));
    assert_eq!(
        search(&catalog, "original", &[(DRIVE, VOLUME_ID)]),
        [r"c:\original.txt"]
    );
    assert!(search(&catalog, "replacement", &[(DRIVE, VOLUME_ID)]).is_empty());
    assert_ready_snapshot(&catalog, 1, "original", VOLUME_ID, Some(CHECKPOINT));

    let mut replacement = catalog
        .begin_drive_refresh(DRIVE)
        .expect("start replacement rebuild");
    replacement
        .insert_batch(&[record("replacement-one.txt"), record("replacement-two.txt")])
        .expect("index replacement files");
    replacement
        .finish_drive_refresh(DRIVE, "replacement", 3, "new-volume", None, || Ok(()))
        .expect("publish replacement");

    assert!(search(&catalog, "original", &[(DRIVE, "new-volume")]).is_empty());
    assert!(search(&catalog, "replacement", &[(DRIVE, VOLUME_ID)]).is_empty());
    assert_eq!(
        search(&catalog, "replacement", &[(DRIVE, "new-volume")]),
        [r"C:\replacement-one.txt"]
    );
    assert_ready_snapshot(&catalog, 2, "replacement", "new-volume", None);
}

#[test]
fn journal_checkpoint_advances_in_the_same_transaction_as_entries() {
    let test_directory = TestDirectory::new();
    let catalog_path = test_directory.0.join("catalog.db");
    let catalog = IndexedCatalogStore::open(catalog_path.clone()).expect("open test catalog");
    catalog
        .begin_drive_refresh(DRIVE)
        .unwrap()
        .finish_drive_refresh(DRIVE, "original", 1, VOLUME_ID, Some(CHECKPOINT), || Ok(()))
        .unwrap();
    let next = JournalCheckpoint {
        next_usn: 456,
        ..CHECKPOINT
    };

    let mut applied = catalog.begin_write().unwrap();
    applied.insert_batch(&[record("applied.txt")]).unwrap();
    assert!(!applied
        .advance_journal_checkpoint(DRIVE, "other-volume", CHECKPOINT, next)
        .unwrap());
    assert!(!applied
        .advance_journal_checkpoint(DRIVE, VOLUME_ID, next, next)
        .unwrap());
    assert!(applied
        .advance_journal_checkpoint(DRIVE, VOLUME_ID, CHECKPOINT, next)
        .unwrap());
    assert_ready_snapshot(&catalog, 0, "original", VOLUME_ID, Some(CHECKPOINT));
    applied.finish().unwrap();

    // Interrupt the second batch after both writes, then resume from disk.
    let end = JournalCheckpoint {
        next_usn: 789,
        ..next
    };
    let mut cancelled = catalog.begin_write().unwrap();
    cancelled.insert_batch(&[record("second.txt")]).unwrap();
    assert!(cancelled
        .advance_journal_checkpoint(DRIVE, VOLUME_ID, next, end)
        .unwrap());
    assert_ready_snapshot(&catalog, 1, "original", VOLUME_ID, Some(next));
    drop(cancelled);
    drop(catalog);

    let reopened = IndexedCatalogStore::open(catalog_path).unwrap();
    assert_ready_snapshot(&reopened, 1, "original", VOLUME_ID, Some(next));
    assert!(search(&reopened, "second", &[(DRIVE, VOLUME_ID)]).is_empty());
    let mut retry = reopened.begin_write().unwrap();
    retry.insert_batch(&[record("second.txt")]).unwrap();
    assert!(retry
        .advance_journal_checkpoint(DRIVE, VOLUME_ID, next, end)
        .unwrap());
    retry.finish().unwrap();
    assert_ready_snapshot(&reopened, 2, "original", VOLUME_ID, Some(end));
    assert_eq!(
        installed_paths(&reopened),
        [r"C:\applied.txt", r"C:\second.txt"]
    );
}

#[test]
fn only_verified_drive_snapshots_supply_search_results() {
    let test_directory = TestDirectory::new();
    let path = test_directory.0.join("catalog.db");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch(r"
        CREATE TABLE indexed_entries (
            entry_id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL,
            normalized_name TEXT NOT NULL, kind INTEGER NOT NULL
        );
        CREATE TABLE indexed_drive_catalog_state (
            drive_path TEXT PRIMARY KEY, lifecycle_state TEXT NOT NULL,
            last_scan_source TEXT, last_scan_started_at INTEGER, last_scan_completed_at INTEGER
        );
        INSERT INTO indexed_drive_catalog_state (drive_path, lifecycle_state) VALUES ('E:\', 'ready');
        INSERT INTO indexed_entries (path, normalized_name, kind) VALUES ('E:\a-topic.txt', 'a-topic.txt', 0);
    ").unwrap();
    drop(connection);

    let store =
        IndexedCatalogStore::open(path).expect("open old catalog without volume identities");
    let old_snapshot = store.load_ready_drive_snapshots().unwrap().pop().unwrap();
    assert_eq!(old_snapshot.drive_path, r"E:\");
    assert_eq!(old_snapshot.volume_id, None);
    assert_eq!(old_snapshot.journal_checkpoint, None);
    assert!(search(&store, "topic", &[(r"E:\", "unknown")]).is_empty());

    let mut detached = store.begin_drive_refresh(DRIVE).unwrap();
    let records = (0..10)
        .map(|index| record(&format!("b{index:02}-topic.txt")))
        .collect::<Vec<_>>();
    detached.insert_batch(&records).unwrap();
    detached
        .finish_drive_refresh(DRIVE, "test", 1, VOLUME_ID, None, || Ok(()))
        .unwrap();

    let mounted_drive = r"D:\";
    let mounted_volume = "volume-d";
    let mut mounted = store.begin_drive_refresh(mounted_drive).unwrap();
    mounted
        .insert_batch(&[CatalogEntryRecord::new(
            r"d:\z-topic.txt".into(),
            "z-topic.txt".into(),
            IndexedEntryKind::File,
        )])
        .unwrap();
    mounted
        .finish_drive_refresh(mounted_drive, "test", 1, mounted_volume, None, || Ok(()))
        .unwrap();

    // The detached and legacy rows sort first. They must be excluded before
    // either the LIKE fallback or FTS caps the set of search candidates.
    let scope = [
        (DRIVE, "replacement-volume"),
        (mounted_drive, mounted_volume),
    ];
    assert_eq!(search(&store, "topic", &scope), [r"d:\z-topic.txt"]);
    assert!(search(&store, "topic", &[]).is_empty());
    assert!(store.backfill_search_index(&|| false).unwrap());
    assert_eq!(search(&store, "topic", &scope), [r"d:\z-topic.txt"]);

    let entries = store
        .connect()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM indexed_entries", [], |row| {
            row.get::<_, usize>(0)
        })
        .unwrap();
    assert_eq!(entries, 12);
    let snapshots = store.load_ready_drive_snapshots().unwrap();
    assert_eq!(
        snapshots
            .iter()
            .find(|drive| drive.drive_path == mounted_drive)
            .unwrap()
            .entry_count,
        Some(1)
    );
}

#[test]
fn saved_metadata_and_search_are_available_before_a_legacy_count_refresh() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    let mut writer = store.begin_drive_refresh(DRIVE).unwrap();
    writer.insert_batch(&[record("existing.txt")]).unwrap();
    writer
        .finish_drive_refresh(DRIVE, "baseline", 1, VOLUME_ID, None, || Ok(()))
        .unwrap();
    let connection = store.connect().unwrap();
    connection
        .execute(
            "UPDATE indexed_drive_catalog_state SET saved_entry_count = NULL",
            [],
        )
        .unwrap();

    let legacy = store.load_ready_drive_snapshots().unwrap().pop().unwrap();
    assert_eq!(legacy.entry_count, None);
    assert_eq!(
        search(&store, "existing", &[(DRIVE, VOLUME_ID)]),
        [r"C:\existing.txt"]
    );
    assert_eq!(store.refresh_ready_drive_count(&legacy).unwrap(), Some(1));

    // Opening metadata does not use the entries table, even after saving a
    // count. A count job targeting a replaced volume cannot change the header.
    let mut wrong_volume = legacy;
    wrong_volume.volume_id = Some("replacement".into());
    assert_eq!(
        store.refresh_ready_drive_count(&wrong_volume).unwrap(),
        None
    );
    connection
        .execute("DROP TABLE indexed_entries", [])
        .unwrap();
    let loaded = store.load_ready_drive_snapshots().unwrap().pop().unwrap();
    assert_eq!(loaded.entry_count, Some(1));
}

fn insert_test_paths(store: &IndexedCatalogStore, paths: &[&str]) {
    let records = paths
        .iter()
        .map(|path| {
            let name = path.rsplit('\\').next().unwrap().to_ascii_lowercase();
            CatalogEntryRecord::new(path.to_string(), name, IndexedEntryKind::File)
        })
        .collect::<Vec<_>>();
    let mut writer = store.begin_write().unwrap();
    writer.insert_batch(&records).unwrap();
    writer.finish().unwrap();
}

fn installed_paths(store: &IndexedCatalogStore) -> Vec<String> {
    let connection = store.connect().unwrap();
    let mut statement = connection
        .prepare("SELECT path FROM indexed_entries ORDER BY path")
        .unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

#[test]
fn indexed_reconciliation_keeps_case_distinct_siblings_and_subtree_boundaries() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    let retained = [
        r"C:\Parent\Item-Other",
        r"C:\Parent\Item-Other\child",
        r"C:\Parent\ItemAB",
        r"C:\Parent\Item_%2\child",
        r"C:\Parent\item_%\other-case-child",
        r"D:\Parent\Item_%\same-name-on-another-volume",
    ];
    insert_test_paths(&store, &retained);
    insert_test_paths(
        &store,
        &[
            r"C:\Parent\Item_%",
            r"c:\Parent\Item_%\older-lowercase-drive",
            r"C:\Parent\Item_%\One",
            r"C:\Parent\Item_%\Two\Nested",
            r"C:\OldSpelling.txt",
        ],
    );

    let mut writer = store.begin_write().unwrap();
    assert!(writer
        .remove_path_trees(&[
            r"C:\Parent\Item_%".to_owned(),
            r"c:\OldSpelling.txt".to_owned()
        ])
        .unwrap());
    // A case-only rename with a known old spelling replaces only that entry.
    writer.insert_batch(&[record("oldspelling.txt")]).unwrap();
    writer.finish().unwrap();

    let mut expected = [retained.as_slice(), &[r"C:\oldspelling.txt"]].concat();
    expected.sort_unstable();
    assert_eq!(installed_paths(&store), expected);
}

#[test]
fn uncertain_path_casing_rolls_back_the_whole_reconcile_batch() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    let retained = [
        r"C:\Earlier.txt",
        r"c:\MiXeD\case_%-other",
        r"c:\MiXeD\case_%\child",
        r"D:\mixed\case_%\other-volume",
    ];
    insert_test_paths(&store, &retained);

    let mut writer = store.begin_write().unwrap();
    assert!(!writer
        .remove_path_trees(&[r"C:\Earlier.txt".to_owned(), r"C:\mixed\CASE_%".to_owned()])
        .unwrap());
    drop(writer);

    let mut expected = retained.to_vec();
    expected.sort_unstable();
    assert_eq!(installed_paths(&store), expected);

    let mut no_alias = store.begin_write().unwrap();
    assert!(no_alias
        .remove_path_trees(&[r"C:\MiXeD\CASE".to_owned()])
        .unwrap());
    no_alias.finish().unwrap();
    assert_eq!(installed_paths(&store), expected);
}

#[test]
fn watched_reconciliation_rolls_back_when_a_subtree_exceeds_its_delete_budget() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    let paths = [r"C:\folder", r"C:\folder\child", r"c:\folder\older"];
    insert_test_paths(&store, &paths);

    let subtree = [r"C:\folder".to_owned()];
    let mut over_budget = store.begin_write().unwrap();
    assert!(!over_budget.remove_watched_path_trees(&subtree, 2).unwrap());
    drop(over_budget);
    assert_eq!(installed_paths(&store), paths);

    let mut bounded = store.begin_write().unwrap();
    assert!(bounded.remove_watched_path_trees(&subtree, 3).unwrap());
    bounded.finish().unwrap();
    assert!(installed_paths(&store).is_empty());
}

#[test]
fn unchanged_watched_subtrees_do_not_acquire_the_write_slot() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    let folder = r"C:\folder";
    let child = r"c:\folder\child";
    let sibling = r"C:\folder-sibling";
    insert_test_paths(&store, &[folder, child, sibling]);

    let same = [
        CatalogEntryRecord::new(child.into(), "child".into(), IndexedEntryKind::File),
        CatalogEntryRecord::new(folder.into(), "folder".into(), IndexedEntryKind::File),
    ];
    // WAL readers can compare while another connection holds the write slot.
    let _other_writer = store.begin_write().unwrap();
    assert!(store
        .begin_watched_write_if_changed(folder, &same, 2)
        .unwrap()
        .is_none());
    assert!(store
        .begin_watched_write_if_changed(r"C:\missing", &[], 2)
        .unwrap()
        .is_none());
    assert!(store
        .begin_watched_write_if_changed(folder, &[], 1)
        .unwrap()
        .is_none());
}

#[test]
fn watched_subtree_comparison_detects_kind_spelling_and_name_changes() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    let folder = r"C:\folder";
    let child = r"C:\folder\child";
    insert_test_paths(&store, &[child]);

    for (path, name, kind) in [
        (child, "child", IndexedEntryKind::Directory),
        (r"C:\folder\Child", "child", IndexedEntryKind::File),
        (child, "corrected", IndexedEntryKind::File),
    ] {
        let replacement = [CatalogEntryRecord::new(path.into(), name.into(), kind)];
        assert!(store
            .begin_watched_write_if_changed(folder, &replacement, 1)
            .unwrap()
            .is_some());
    }

    let replacement = [CatalogEntryRecord::new(
        r"C:\folder\Child".into(),
        "child".into(),
        IndexedEntryKind::Directory,
    )];
    let mut writer = store
        .begin_watched_write_if_changed(folder, &replacement, 1)
        .unwrap()
        .unwrap();
    assert!(writer
        .remove_watched_path_trees(&[folder.into()], 1)
        .unwrap());
    writer.insert_batch(&replacement).unwrap();
    writer.finish().unwrap();
    assert_eq!(installed_paths(&store), [r"C:\folder\Child"]);
    assert!(store
        .begin_watched_write_if_changed(folder, &replacement, 1)
        .unwrap()
        .is_none());
}

#[test]
fn new_paths_need_a_consistent_indexed_ancestor_spelling() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    insert_test_paths(&store, &[r"c:\Parent", r"D:\pArEnT"]);

    let mut ambiguous = store.begin_write().unwrap();
    assert!(!ambiguous
        .remove_path_trees(&[r"C:\pArEnT\new\leaf.txt".into()])
        .unwrap());
    drop(ambiguous);

    let mut canonical = store.begin_write().unwrap();
    assert!(canonical
        .remove_path_trees(&[r"C:\Parent\new\leaf.txt".into()])
        .unwrap());
    canonical.finish().unwrap();
    assert_eq!(installed_paths(&store), [r"D:\pArEnT", r"c:\Parent"]);
}

#[test]
fn reconciliation_statements_use_the_path_index() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    let connection = store.connect().unwrap();
    for (sql, bindings, expected_seeks) in [
        (
            paths::DELETE_PATH_TREE,
            [r"C:\Parent", r"C:\Parent\", "C:\\Parent]"].as_slice(),
            2,
        ),
        (
            paths::FIND_PATH_TREE,
            [r"C:\Parent", r"C:\Parent\", "C:\\Parent]"].as_slice(),
            2,
        ),
        (
            paths::READ_PATH_TREE,
            [r"C:\Parent", r"C:\Parent\", "C:\\Parent]", "513"].as_slice(),
            2,
        ),
        (paths::SEEK_PATH, [r"C:\Parent"].as_slice(), 1),
    ] {
        let mut statement = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .unwrap();
        let plan = statement
            .query_map(rusqlite::params_from_iter(bindings), |row| {
                row.get::<_, String>(3)
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            plan.iter()
                .filter(
                    |detail| detail.contains("SEARCH indexed_entries") && detail.contains("(path")
                )
                .count(),
            expected_seeks,
            "{plan:?}",
        );
        assert!(
            plan.iter()
                .all(|detail| !detail.contains("SCAN indexed_entries")),
            "{plan:?}",
        );
    }
}
