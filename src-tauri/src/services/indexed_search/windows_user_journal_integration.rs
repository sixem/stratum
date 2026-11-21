// Opt-in integration test using a disposable subtree on a standard-user NTFS volume.
use std::{
    collections::BTreeSet,
    env, fs, mem,
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    path::{Path, PathBuf},
};

use windows_sys::Win32::{
    Foundation::HANDLE,
    Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_READ_ATTRIBUTES,
    },
    System::Ioctl::{
        USN_REASON_FILE_CREATE, USN_REASON_FILE_DELETE, USN_REASON_RENAME_NEW_NAME,
        USN_REASON_RENAME_OLD_NAME,
    },
};

use super::{
    catalog::{IndexedCatalogStore, JournalCheckpoint},
    scan,
    user_journal_reconcile::{reconcile_user_journal_batch, UserReconcileOutcome},
    volume_tracking::{discover_drive, VolumeMount},
    windows_user_journal::{self, ResolvedDirectory, UserJournalBatch, UserJournalChanges},
};

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let directory = env::var_os("STRATUM_USER_JOURNAL_TEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(env::temp_dir);
        let mut unique = [0_u8; 8];
        getrandom::fill(&mut unique).unwrap();
        let path = directory.join(format!(
            "stratum-user-journal-{:016x}",
            u64::from_le_bytes(unique)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn logical_path(path: &Path) -> String {
    let absolute = path.canonicalize().unwrap();
    let text = absolute.to_str().unwrap();
    text.strip_prefix(r"\\?\").unwrap_or(text).to_owned()
}

fn mount_for_directory(path: &str) -> VolumeMount {
    assert!(
        matches!(path.as_bytes(), [letter, b':', b'\\', ..] if letter.is_ascii_alphabetic()),
        "The test folder needs a local drive letter"
    );
    let drive = discover_drive(&path[..3]);
    assert!(drive.status.indexable, "The test folder needs fixed NTFS");
    VolumeMount {
        drive_path: drive.status.drive_path,
        guid: drive.volume_guid.unwrap(),
        identity: drive.volume_identity.unwrap(),
    }
}

fn file_reference(directory: &Path) -> u64 {
    let handle = fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(directory)
        .unwrap();
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { mem::zeroed() };
    let opened = unsafe { GetFileInformationByHandle(handle.as_raw_handle() as HANDLE, &mut info) };
    assert_ne!(opened, 0, "{}", std::io::Error::last_os_error());
    (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow)
}

fn saved_checkpoint(catalog: &IndexedCatalogStore) -> JournalCheckpoint {
    let snapshots = catalog.load_ready_drive_snapshots().unwrap();
    assert_eq!(snapshots.len(), 1);
    snapshots[0].journal_checkpoint.unwrap()
}

fn checkpoint(mount: &VolumeMount) -> JournalCheckpoint {
    let snapshot = windows_user_journal::snapshot(&mount.guid).unwrap();
    JournalCheckpoint {
        journal_id: snapshot.journal_id,
        next_usn: snapshot.next_usn,
    }
}

fn indexed_paths(catalog: &IndexedCatalogStore) -> BTreeSet<String> {
    let connection = catalog.connect().unwrap();
    let mut statement = connection
        .prepare("SELECT path FROM indexed_entries")
        .unwrap();
    statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn apply_offline_changes(root: &Path) {
    fs::rename(root.join(r"left\before.txt"), root.join(r"right\after.txt")).unwrap();
    fs::remove_file(root.join(r"left\deleted.txt")).unwrap();
    fs::write(root.join(r"right\created.txt"), b"new file").unwrap();
    fs::write(root.join(r"right\created-too.txt"), b"second new file").unwrap();
    fs::rename(root.join(r"left\folder"), root.join(r"right\moved-folder")).unwrap();
    fs::remove_file(root.join(r"right\discarded\child.txt")).unwrap();
    fs::remove_dir(root.join(r"right\discarded")).unwrap();
    // A directory that reappears under the same name must lose its old descendants.
    fs::create_dir(root.join(r"left\folder")).unwrap();
    fs::write(root.join(r"left\folder\replacement.txt"), b"replacement").unwrap();
}

fn read_fixture_changes(
    mount: &VolumeMount,
    previous: JournalCheckpoint,
    through: JournalCheckpoint,
    fixture_parents: &[u64],
) -> UserJournalBatch {
    assert_eq!(previous.journal_id, through.journal_id);
    let mut cursor = previous;
    let mut changes = Vec::new();
    for _ in 0..32 {
        let UserJournalChanges::Batch(batch) =
            windows_user_journal::read_changes(&mount.guid, cursor, &|| false).unwrap()
        else {
            panic!("The live test journal became unreadable");
        };
        assert!(batch.next.next_usn > cursor.next_usn);
        cursor = batch.next;
        // The host volume is active. Only reconcile events for the test subtree.
        changes.extend(
            batch
                .changes
                .into_iter()
                .filter(|record| fixture_parents.contains(&record.parent_file_id)),
        );
        if cursor.next_usn >= through.next_usn {
            return UserJournalBatch {
                previous,
                next: cursor,
                has_more: false,
                changes,
            };
        }
    }
    panic!("The test journal backlog exceeded 32 batches");
}

#[test]
#[ignore = "requires a standard Windows token and a fixed NTFS volume with a live change journal"]
fn user_journal_replays_offline_changes_and_persists_its_checkpoint() {
    assert!(!crate::platform::windows::process_token::is_process_elevated().unwrap());
    let scratch = Scratch::new();
    let index_dir = scratch.0.join("index");
    let root = scratch.0.join("entries");
    let left = root.join("left");
    let right = root.join("right");
    let discarded = right.join("discarded");
    fs::create_dir(&index_dir).unwrap();
    fs::create_dir_all(left.join("folder")).unwrap();
    fs::create_dir_all(&discarded).unwrap();
    fs::write(left.join("before.txt"), b"rename").unwrap();
    fs::write(left.join("deleted.txt"), b"delete").unwrap();
    fs::write(left.join(r"folder\original.txt"), b"move with folder").unwrap();
    fs::write(right.join("unchanged.txt"), b"keep").unwrap();
    fs::write(discarded.join("child.txt"), b"discard with folder").unwrap();
    let discarded_id = file_reference(&discarded);

    let logical_root = logical_path(&root);
    let mount = mount_for_directory(&logical_root);
    let db_path = index_dir.join("catalog.sqlite3");
    let catalog = IndexedCatalogStore::open(db_path.clone()).unwrap();
    let before = checkpoint(&mount);
    let mut writer = catalog.begin_drive_refresh(&mount.drive_path).unwrap();
    scan::scan_path_into_writer(&root, Path::new(&logical_root), None, &mut writer, &|| {
        false
    })
    .unwrap();
    writer
        .finish_drive_refresh(
            &mount.drive_path,
            "test baseline",
            0,
            &mount.identity,
            Some(before),
            || mount.verify(),
        )
        .unwrap();
    let baseline_paths = indexed_paths(&catalog);
    drop(catalog);

    apply_offline_changes(&root);
    let through = checkpoint(&mount);
    let catalog = IndexedCatalogStore::open(db_path.clone()).unwrap();
    assert_eq!(saved_checkpoint(&catalog), before);
    let parents = [file_reference(&left), file_reference(&right)];
    let batch = read_fixture_changes(
        &mount,
        before,
        through,
        &[parents[0], parents[1], discarded_id],
    );
    let reasons = batch
        .changes
        .iter()
        .fold(0, |bits, record| bits | record.reason);
    for reason in [
        USN_REASON_FILE_CREATE,
        USN_REASON_FILE_DELETE,
        USN_REASON_RENAME_OLD_NAME,
        USN_REASON_RENAME_NEW_NAME,
    ] {
        assert_ne!(reasons & reason, 0);
    }
    let resolver = windows_user_journal::open_directory_resolver(&mount.guid).unwrap();
    assert_eq!(
        resolver.resolve(discarded_id).unwrap(),
        ResolvedDirectory::Missing
    );
    for (id, expected) in parents.into_iter().zip([left, right]) {
        let ResolvedDirectory::Path(relative) = resolver.resolve(id).unwrap() else {
            panic!("The standard user could not resolve the changed parent");
        };
        let prefix = mount.drive_path.trim_end_matches('\\');
        assert_eq!(format!("{prefix}{relative}"), logical_path(&expected));
    }

    let next = batch.next;
    let UserReconcileOutcome::Committed {
        changed_paths: true,
        entry_count: Some(entry_count),
    } = reconcile_user_journal_batch(&catalog, &mount, batch, &|| false).unwrap()
    else {
        panic!("Reconciliation did not publish the changed paths");
    };
    drop(catalog);
    let reopened = IndexedCatalogStore::open(db_path).unwrap();
    assert_eq!(saved_checkpoint(&reopened), next);
    let mut expected = baseline_paths;
    for removed in [
        r"left\before.txt",
        r"left\deleted.txt",
        r"left\folder\original.txt",
        r"right\discarded",
        r"right\discarded\child.txt",
    ] {
        assert!(expected.remove(&format!(r"{logical_root}\{removed}")));
    }
    for added in [
        r"right\after.txt",
        r"right\created.txt",
        r"right\created-too.txt",
        r"right\moved-folder",
        r"right\moved-folder\original.txt",
        r"left\folder\replacement.txt",
    ] {
        expected.insert(format!(r"{logical_root}\{added}"));
    }
    assert_eq!(entry_count, expected.len());
    assert_eq!(
        reopened.load_ready_drive_snapshots().unwrap()[0].entry_count,
        Some(expected.len())
    );
    assert_eq!(indexed_paths(&reopened), expected);
}
