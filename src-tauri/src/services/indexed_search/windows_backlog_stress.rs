// Opt-in Windows integration test. The disposable-volume runner invokes each
// phase in a separate process, using an offline catalog copy and a letterless
// NTFS volume. The synthetic drive letter exists only in catalog strings.
use std::{
    cell::Cell,
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
};

use rusqlite::params;

use super::{
    catalog::{IndexedCatalogStore, JournalCheckpoint},
    journal_batch::JournalBatch,
    reconcile::{reconcile_journal_batch, ReconcileOutcome},
    scan,
    volume_tracking::VolumeMount,
    windows_journal::{self, JournalChanges},
};

const LOGICAL_ROOT: &str = r"Q:\";
const TREE: &str = "backlog-fixture";
const OLD_SPELLING: &str = "OriginalÅ";
const NEW_SPELLING: &str = "Originalå";
const FILE_COUNT: usize = 1_200;
const RECORD_LIMIT: usize = 512;

struct Fixture {
    mount: VolumeMount,
    store: IndexedCatalogStore,
    token: String,
}

impl Fixture {
    fn open() -> Self {
        let run = PathBuf::from(env::var_os("STRATUM_USN_TEST_DIR").unwrap());
        let guid = env::var("STRATUM_USN_TEST_VOLUME_GUID").unwrap();
        assert!(guid.starts_with(r"\\?\Volume{") && guid.ends_with("}\\"));
        let token = fs::read_to_string(run.join("owner.txt")).unwrap();
        assert!(token.len() >= 32);
        let mount = VolumeMount {
            drive_path: LOGICAL_ROOT.to_owned(),
            identity: format!("disposable-{token}"),
            guid,
        };
        assert_eq!(
            fs::read_to_string(Path::new(&mount.guid).join("stratum-usn-test-owner")).unwrap(),
            token
        );
        let db = run.join("catalog-copy.sqlite3");
        assert!(db.is_file());
        let store = IndexedCatalogStore::open(db).unwrap();
        Self {
            mount,
            store,
            token,
        }
    }

    fn verify(&self) -> Result<(), String> {
        let marker = Path::new(&self.mount.guid).join("stratum-usn-test-owner");
        if fs::read_to_string(marker).map_err(|e| e.to_string())? == self.token {
            Ok(())
        } else {
            Err("Disposable volume token changed".into())
        }
    }

    fn tree(&self) -> PathBuf {
        Path::new(&self.mount.guid).join(TREE)
    }

    fn saved(&self) -> JournalCheckpoint {
        self.store
            .connect()
            .unwrap()
            .query_row(
                "SELECT journal_id, journal_next_usn FROM indexed_drive_catalog_state
             WHERE drive_path = ? AND volume_id = ?",
                params![LOGICAL_ROOT, self.mount.identity],
                |row| {
                    Ok(JournalCheckpoint {
                        journal_id: row.get::<_, i64>(0)? as u64,
                        next_usn: row.get(1)?,
                    })
                },
            )
            .unwrap()
    }

    fn read(&self, previous: JournalCheckpoint) -> Option<JournalBatch> {
        match windows_journal::read_changes(LOGICAL_ROOT, &self.mount.guid, previous, &|| false)
            .unwrap()
        {
            JournalChanges::Batch(batch) => {
                assert!(batch.changes.len() <= RECORD_LIMIT);
                Some(batch)
            }
            JournalChanges::NeedsRebuild => None,
            JournalChanges::Cancelled => panic!("Unexpected journal read cancellation"),
        }
    }

    fn apply(&self, batch: JournalBatch, cancel: &impl Fn() -> bool) -> ReconcileOutcome {
        reconcile_journal_batch(&self.store, &self.mount, batch, cancel, &|| self.verify()).unwrap()
    }

    fn indexed(&self) -> BTreeSet<String> {
        let db = self.store.connect().unwrap();
        let mut rows = db
            .prepare("SELECT path FROM indexed_entries WHERE path >= ?1 AND path < ?2")
            .unwrap();
        rows.query_map(params![r"Q:\backlog-fixture", r"Q:\backlog-fixturf"], |r| {
            r.get(0)
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
    }
}

fn create_and_pause(f: &Fixture) {
    let tree = f.tree();
    fs::create_dir(&tree).unwrap();
    fs::create_dir(tree.join("oldtree")).unwrap();
    fs::create_dir(tree.join("destination")).unwrap();
    fs::write(tree.join("oldtree").join("child"), b"dir move").unwrap();
    fs::write(tree.join(OLD_SPELLING), b"case").unwrap();
    for i in 0..FILE_COUNT {
        fs::File::create(tree.join(format!("before-{i:04}"))).unwrap();
    }
    let snapshot = windows_journal::snapshot(&f.mount.guid).unwrap();
    let first = JournalCheckpoint {
        journal_id: snapshot.journal_id,
        next_usn: snapshot.next_usn,
    };
    let mut writer = f.store.begin_drive_refresh(LOGICAL_ROOT).unwrap();
    scan::scan_path_into_writer(
        &tree,
        &Path::new(LOGICAL_ROOT).join(TREE),
        None,
        &mut writer,
        &|| false,
    )
    .unwrap();
    writer
        .finish_drive_refresh(
            LOGICAL_ROOT,
            "fixture",
            0,
            &f.mount.identity,
            Some(first),
            || f.verify(),
        )
        .unwrap();

    fs::rename(
        tree.join("oldtree"),
        tree.join("destination").join("oldtree"),
    )
    .unwrap();
    for i in 0..FILE_COUNT {
        fs::rename(
            tree.join(format!("before-{i:04}")),
            tree.join(format!("after-{i:04}")),
        )
        .unwrap();
    }
    let baseline = f.indexed();
    let batch = f
        .read(first)
        .expect("ordinary rename backlog required a rebuild");
    assert!(batch.has_more);
    let polls = Cell::new(0);
    let cancelled = f.apply(batch, &|| {
        polls.set(polls.get() + 1);
        polls.get() >= 8
    });
    assert!(matches!(cancelled, ReconcileOutcome::Cancelled));
    assert_eq!(f.saved(), first);
    assert_eq!(f.indexed(), baseline);

    let batch = f.read(first).unwrap();
    let next = batch.next;
    assert!(next.next_usn > first.next_usn);
    assert!(matches!(
        f.apply(batch, &|| false),
        ReconcileOutcome::Committed { .. }
    ));
    assert_eq!(f.saved(), next);
    assert_ne!(f.indexed(), baseline);
    eprintln!(
        "Cancelled batch rolled back; first partial checkpoint committed at {}",
        next.next_usn
    );
}

fn disk_tree(root: &Path) -> BTreeSet<String> {
    let mut paths = BTreeSet::new();
    let mut todo = vec![(root.to_owned(), Path::new(LOGICAL_ROOT).join(TREE))];
    while let Some((physical, logical)) = todo.pop() {
        paths.insert(logical.to_str().unwrap().to_owned());
        if physical.is_dir() {
            for entry in fs::read_dir(physical).unwrap() {
                let entry = entry.unwrap();
                todo.push((entry.path(), logical.join(entry.file_name())));
            }
        }
    }
    paths
}

fn resume(f: &Fixture) {
    let mut batches = 1;
    loop {
        let previous = f.saved();
        let batch = f
            .read(previous)
            .expect("ordinary rename backlog required a rebuild");
        let next = batch.next;
        let more = batch.has_more;
        assert!(previous.next_usn < next.next_usn);
        assert!(matches!(
            f.apply(batch, &|| false),
            ReconcileOutcome::Committed { .. }
        ));
        assert_eq!(f.saved(), next);
        batches += 1;
        assert!(batches < 32);
        if !more {
            break;
        }
    }
    assert!(batches >= 4);
    assert_eq!(f.indexed(), disk_tree(&f.tree()));
    let db = f.store.connect().unwrap();
    let backgrounds: i64 = db
        .query_row(
            "SELECT count(*) FROM indexed_entries WHERE path >= 'B:' AND path < 'C:'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(backgrounds, 5_230_000);
    eprintln!("Reopened saved checkpoint; {batches} bounded transactions reconciled {FILE_COUNT} renames and the directory move");
}

// NTFS emits more than one record for some filesystem operations. Measure
// empty-file creates and renames on this volume to put OLD_NAME in slot 512.
fn split_case_rename(f: &Fixture) {
    let tree = f.tree();
    let previous = f.saved();
    fs::File::create(tree.join("padding-0")).unwrap();
    let create_count = f.read(previous).unwrap().changes.len();
    fs::rename(tree.join("after-0000"), tree.join("moved-0000")).unwrap();
    let count = f.read(previous).unwrap().changes.len();
    let rename_count = count - create_count;
    assert!(create_count > 0 && rename_count > 0);
    let needed = RECORD_LIMIT - 1 - count;
    let creates = (0..=needed / create_count)
        .find(|c| (needed - c * create_count) % rename_count == 0)
        .expect("these NTFS record counts cannot align the pair across this batch");
    let renames = (needed - creates * create_count) / rename_count;
    for i in 1..=creates {
        fs::File::create(tree.join(format!("padding-{i}"))).unwrap();
    }
    for i in 1..=renames {
        fs::rename(
            tree.join(format!("after-{i:04}")),
            tree.join(format!("moved-{i:04}")),
        )
        .unwrap();
    }
    assert_eq!(f.read(previous).unwrap().changes.len(), RECORD_LIMIT - 1);
    fs::rename(tree.join(OLD_SPELLING), tree.join(NEW_SPELLING)).unwrap();
    let batch = f
        .read(previous)
        .expect("case rename must be split between batches");
    assert!(batch.has_more);
    assert_eq!(batch.changes.len(), RECORD_LIMIT);
    assert!(batch.changes.last().unwrap().path.ends_with(OLD_SPELLING));
    let next = batch.next;
    assert!(matches!(
        f.apply(batch, &|| false),
        ReconcileOutcome::Committed {
            pending_renames: true,
            ..
        }
    ));
    assert_eq!(f.saved(), next);
    assert!(f
        .indexed()
        .contains(&format!(r"{LOGICAL_ROOT}{TREE}\{OLD_SPELLING}")));
    eprintln!("Committed OLD_NAME alone at slot {RECORD_LIMIT}; restarting before NEW_NAME");
}

fn reject_case_rename(f: &Fixture) {
    let previous = f.saved();
    let baseline = f.indexed();
    let batch = f
        .read(previous)
        .expect("the remaining records have only the new spelling");
    assert!(batch.changes.first().unwrap().path.ends_with(NEW_SPELLING));
    assert!(matches!(
        f.apply(batch, &|| false),
        ReconcileOutcome::NeedsRebuild
    ));
    assert_eq!(f.saved(), previous);
    assert_eq!(f.indexed(), baseline);
    eprintln!("Reopened pending OLD_NAME; case ambiguity requested a rebuild without advancing the cursor");
}

// Build background rows with the real schema and FTS triggers. The runner
// copies the closed seed to a second path before running any journal tests.
fn seed_catalog() {
    let run = PathBuf::from(env::var_os("STRATUM_USN_TEST_DIR").unwrap());
    let seed = run.join("seed.sqlite3");
    fs::File::create_new(&seed).unwrap();
    let store = IndexedCatalogStore::open(seed).unwrap();
    let db = store.connect().unwrap();
    db.execute_batch(
        r"PRAGMA journal_mode = OFF;
          PRAGMA synchronous = OFF;
          PRAGMA cache_size = -131072;
          WITH RECURSIVE numbers(n) AS (
              VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n < 5230000
          )
          INSERT INTO indexed_entries(entry_id, path, normalized_name, kind)
          SELECT n, printf('B:\offline\%07d.txt', n), printf('%07d.txt', n), 0 FROM numbers;
          PRAGMA journal_mode = DELETE;",
    )
    .unwrap();
    for table in ["indexed_entries", "indexed_entry_fts"] {
        let count: i64 = db
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 5_230_000);
    }
    eprintln!("Generated a synthetic offline seed with 5,230,000 catalog entries and FTS rows");
}

#[test]
#[ignore = "requires a letterless disposable NTFS volume and offline fixture catalog"]
fn disposable_ntfs_backlog() {
    let phase = env::var("STRATUM_USN_TEST_PHASE").unwrap();
    if phase == "seed" {
        seed_catalog();
        return;
    }
    let f = Fixture::open();
    match phase.as_str() {
        "start" => create_and_pause(&f),
        "resume" => {
            resume(&f);
            split_case_rename(&f);
        }
        "case" => reject_case_rename(&f),
        "recreated" => {
            let saved = f.saved();
            assert_ne!(
                windows_journal::snapshot(&f.mount.guid).unwrap().journal_id,
                saved.journal_id
            );
            assert!(f.read(saved).is_none());
            assert_eq!(f.saved(), saved);
            eprintln!("Recreated journal rejected the previous durable cursor");
        }
        phase => panic!("Unexpected test phase {phase}"),
    }
}
