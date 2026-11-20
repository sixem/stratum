// Exercise restart, visibility, and remount boundaries with a disposable DB.
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use super::*;
use crate::domain::indexed_search::{IndexedEntryKind, IndexedPathQuery};

const DRIVE: &str = r"C:\";
const VOLUME: &str = "fixture-volume";

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "stratum-recursive-build-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }

    fn catalog(&self) -> IndexedCatalogStore {
        IndexedCatalogStore::open(self.0.join("catalog.db")).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn record(path: &str, kind: IndexedEntryKind) -> CatalogEntryRecord {
    let name = path.rsplit('\\').next().unwrap().to_ascii_lowercase();
    CatalogEntryRecord::new(path.to_owned(), name, kind)
}

fn find(catalog: &IndexedCatalogStore, name: &str, volume: &str) -> Vec<String> {
    catalog
        .query(
            IndexedPathQuery {
                query: name.into(),
                limit: Some(10),
            },
            &[(DRIVE.into(), volume.into())],
        )
        .unwrap()
        .into_iter()
        .map(|record| record.path)
        .collect()
}

#[test]
fn interrupted_first_scan_keeps_finished_directories_and_hides_all_staged_rows() {
    let fixture = Fixture::new();
    let catalog = fixture.catalog();
    let mut scan = RecursiveBuild::open(&catalog, DRIVE, VOLUME, 1)
        .unwrap()
        .unwrap();
    scan.clear_interrupted_directory(&|| false).unwrap();
    assert_eq!(scan.next_directory().unwrap().as_deref(), Some(""));
    scan.write_chunk(
        "",
        &[
            record(r"C:\done.txt", IndexedEntryKind::File),
            record(r"C:\pending", IndexedEntryKind::Directory),
        ],
        &["pending".into()],
        0,
        true,
    )
    .unwrap();
    assert_eq!(scan.next_directory().unwrap().as_deref(), Some("pending"));
    scan.write_chunk(
        "pending",
        &[record(r"C:\pending\obsolete.txt", IndexedEntryKind::File)],
        &[r"pending\stale-child".into()],
        0,
        false,
    )
    .unwrap();
    assert!(catalog.load_ready_drive_snapshots().unwrap().is_empty());
    assert!(find(&catalog, "done", VOLUME).is_empty());
    drop(scan);
    drop(catalog);

    let catalog = fixture.catalog();
    let mut scan = RecursiveBuild::open(&catalog, DRIVE, VOLUME, 2)
        .unwrap()
        .unwrap();
    assert_eq!(scan.entries, 2);
    scan.clear_interrupted_directory(&|| false).unwrap();
    assert_eq!(scan.next_directory().unwrap().as_deref(), Some("pending"));
    scan.write_chunk(
        "pending",
        &[record(r"C:\pending\current.txt", IndexedEntryKind::File)],
        &[],
        0,
        true,
    )
    .unwrap();
    assert!(scan.next_directory().unwrap().is_none());
    assert!(scan
        .publish("recursive fallback", || Err("drive changed".into()))
        .is_err());
    assert!(catalog.load_ready_drive_snapshots().unwrap().is_empty());
    assert!(find(&catalog, "current", VOLUME).is_empty());
    scan.publish("recursive fallback", || Ok(())).unwrap();

    let snapshots = catalog.load_ready_drive_snapshots().unwrap();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].entry_count, Some(3));
    assert_eq!(find(&catalog, "done", VOLUME), [r"C:\done.txt"]);
    assert_eq!(
        find(&catalog, "current", VOLUME),
        [r"C:\pending\current.txt"]
    );
    assert!(find(&catalog, "obsolete", VOLUME).is_empty());
    assert!(RecursiveBuild::open(&catalog, DRIVE, VOLUME, 3)
        .unwrap()
        .is_none());
}

#[test]
fn a_replacement_volume_discards_partial_rows_and_invalidates_the_old_attempt() {
    let fixture = Fixture::new();
    let catalog = fixture.catalog();
    let mut original = RecursiveBuild::open(&catalog, DRIVE, VOLUME, 1)
        .unwrap()
        .unwrap();
    original.clear_interrupted_directory(&|| false).unwrap();
    original
        .write_chunk(
            "",
            &[record(r"C:\former.txt", IndexedEntryKind::File)],
            &[],
            0,
            true,
        )
        .unwrap();

    let replacement_volume = "replacement-volume";
    let mut replacement = RecursiveBuild::open(&catalog, DRIVE, replacement_volume, 2)
        .unwrap()
        .unwrap();
    assert!(original.publish("recursive fallback", || Ok(())).is_err());
    assert!(original.write_chunk("", &[], &[], 0, true).is_err());
    replacement.clear_interrupted_directory(&|| false).unwrap();
    assert_eq!(replacement.next_directory().unwrap().as_deref(), Some(""));
    replacement
        .write_chunk(
            "",
            &[record(r"C:\replacement.txt", IndexedEntryKind::File)],
            &[],
            0,
            true,
        )
        .unwrap();
    replacement
        .publish("recursive fallback", || Ok(()))
        .unwrap();

    assert!(find(&catalog, "former", VOLUME).is_empty());
    assert!(find(&catalog, "former", replacement_volume).is_empty());
    assert_eq!(
        find(&catalog, "replacement", replacement_volume),
        [r"C:\replacement.txt"]
    );
}
