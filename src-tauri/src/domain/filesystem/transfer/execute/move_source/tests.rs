// Exercise move cleanup against disposable files at the copy/cleanup boundary.
use super::*;
use crate::domain::filesystem::transfer::manifest::build_manifest_root;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

struct TestDir(PathBuf);

impl TestDir {
    fn new(parent: &Path) -> Self {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        loop {
            let id = SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!("stratum-move-cleanup-{}-{id}", std::process::id()));
            match fs::create_dir(&path) {
                Ok(()) => return Self(path),
                Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(err) => panic!("Could not create {}: {err}", path.display()),
            }
        }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn copy_fixture(root: &Path) -> (TransferManifestRoot, Vec<SourceSnapshot>) {
    let source = root.join("source");
    fs::create_dir_all(source.join("nested")).unwrap();
    fs::write(source.join("nested/copied.txt"), b"old file").unwrap();
    copy_tree(&source, &root.join("destination"))
}

fn copy_tree(source: &Path, target: &Path) -> (TransferManifestRoot, Vec<SourceSnapshot>) {
    let manifest = build_manifest_root(source, target, &mut None).unwrap();
    let snapshots = manifest
        .entries
        .iter()
        .map(|entry| {
            SourceSnapshot::copy(entry, || {
                let result = if entry.kind.is_traversable_directory() {
                    fs::create_dir(&entry.destination)
                } else {
                    fs::copy(&entry.source, &entry.destination).map(|_| ())
                };
                result.map_err(|err| err.to_string())
            })
            .unwrap()
        })
        .collect();
    (manifest, snapshots)
}

#[test]
fn move_cleanup_removes_only_the_copied_directory_entries() {
    let temp = TestDir::new(&std::env::temp_dir());
    let (manifest, snapshots) = copy_fixture(&temp.0);
    let nested = manifest.source.join("nested");
    fs::write(nested.join("late.txt"), b"new child").unwrap();
    remove_manifest_source(&manifest, &snapshots)
        .expect_err("the source folder still has children");
    assert!(!nested.join("copied.txt").exists());
    assert_eq!(fs::read(nested.join("late.txt")).unwrap(), b"new child");
    assert_eq!(
        fs::read(manifest.destination.join("nested/copied.txt")).unwrap(),
        b"old file"
    );
    assert!(!manifest.destination.join("nested/late.txt").exists());
}

#[test]
fn move_cleanup_finishes_an_unchanged_tree() {
    let temp = TestDir::new(&std::env::temp_dir());
    let (manifest, snapshots) = copy_fixture(&temp.0);
    remove_manifest_source(&manifest, &snapshots).unwrap();
    assert!(!manifest.source.exists());
    assert_eq!(
        fs::read(manifest.destination.join("nested/copied.txt")).unwrap(),
        b"old file"
    );
}

#[test]
fn move_cleanup_preserves_a_same_name_replacement() {
    let temp = TestDir::new(&std::env::temp_dir());
    let (manifest, snapshots) = copy_fixture(&temp.0);
    let path = manifest.source.join("nested/copied.txt");
    let original_time = fs::metadata(&path).unwrap().modified().unwrap();
    fs::rename(&path, temp.0.join("original.txt")).unwrap();
    fs::write(&path, b"new file").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(original_time)
        .unwrap();
    remove_manifest_source(&manifest, &snapshots).expect_err("file ID changed");
    assert_eq!(fs::read(&path).unwrap(), b"new file");
}

#[test]
fn move_cleanup_preserves_a_modified_source_file() {
    let temp = TestDir::new(&std::env::temp_dir());
    let (manifest, snapshots) = copy_fixture(&temp.0);
    let path = manifest.source.join("nested/copied.txt");
    let original_time = fs::metadata(&path).unwrap().modified().unwrap();
    // Cross an NTFS system clock tick before writing the same number of bytes.
    std::thread::sleep(std::time::Duration::from_millis(32));
    fs::write(&path, b"modified").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(original_time)
        .unwrap();
    remove_manifest_source(&manifest, &snapshots).expect_err("copied version changed");
    assert_eq!(fs::read(&path).unwrap(), b"modified");
}

#[cfg(windows)]
#[test]
fn move_cleanup_handles_two_names_for_the_same_file() {
    let temp = TestDir::new(&std::env::temp_dir());
    let source = temp.0.join("source");
    for dir in ["A", "B"] {
        fs::create_dir_all(source.join(dir)).unwrap();
    }
    fs::write(source.join("A/first"), b"linked").unwrap();
    fs::hard_link(source.join("A/first"), source.join("B/second")).unwrap();
    let (manifest, snapshots) = copy_tree(&source, &temp.0.join("destination"));
    remove_manifest_source(&manifest, &snapshots).unwrap();
    assert!(!source.exists());
    for name in ["A/first", "B/second"] {
        assert_eq!(
            fs::read(manifest.destination.join(name)).unwrap(),
            b"linked"
        );
    }
}

#[test]
fn move_cleanup_keeps_modified_hard_links() {
    let temp = TestDir::new(&std::env::temp_dir());
    let source = temp.0.join("source");
    fs::create_dir(&source).unwrap();
    let first = source.join("first");
    let second = source.join("second");
    fs::write(&first, b"linked").unwrap();
    fs::hard_link(&first, &second).unwrap();
    let (manifest, snapshots) = copy_tree(&source, &temp.0.join("destination"));
    let original_time = fs::metadata(&first).unwrap().modified().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(32));
    fs::write(&second, b"edited").unwrap();
    fs::File::options()
        .write(true)
        .open(&first)
        .unwrap()
        .set_modified(original_time)
        .unwrap();
    remove_manifest_source(&manifest, &snapshots).expect_err("linked source changed");
    for path in [first, second] {
        assert_eq!(fs::read(path).unwrap(), b"edited");
    }
}

#[cfg(windows)]
#[test]
fn move_cleanup_blocks_writes_through_other_links_between_unlinks() {
    let temp = TestDir::new(&std::env::temp_dir());
    let source = temp.0.join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("one"), b"linked").unwrap();
    fs::hard_link(source.join("one"), source.join("two")).unwrap();
    let (manifest, snapshots) = copy_tree(&source, &temp.0.join("destination"));
    let mut aliases = windows::LinkedSources::new(&snapshots);
    let first = &manifest.entries[1];
    let second = &manifest.entries[2];
    let file = SourceFile::open(&first.source, true).unwrap();
    let actual = SourceSnapshot::read(&file, first).unwrap();
    assert!(aliases.verify(first, &snapshots[1], actual).unwrap());
    file.remove(first).unwrap();
    drop(file);
    let attempt = fs::File::options()
        .write(true)
        .open(&second.source)
        .unwrap_err();
    assert_eq!(
        attempt.raw_os_error(),
        Some(windows_sys::Win32::Foundation::ERROR_SHARING_VIOLATION as i32)
    );
    drop(aliases);
    fs::write(&second.source, b"writable again").unwrap();
}

#[cfg(windows)]
#[test]
fn move_cleanup_keeps_a_replacement_junction_and_its_target() {
    let temp = TestDir::new(&std::env::temp_dir());
    let (manifest, snapshots) = copy_fixture(&temp.0);
    let nested = manifest.source.join("nested");
    let external = temp.0.join("external");
    fs::rename(&nested, &external).unwrap();
    let status = std::process::Command::new("cmd.exe")
        .current_dir(&temp.0)
        .args(["/d", "/c", "mklink", "/j", r"source\nested", "external"])
        .output()
        .unwrap();
    assert!(status.status.success(), "{:?}", status);
    remove_manifest_source(&manifest, &snapshots).expect_err("source directory became a junction");
    assert_eq!(fs::read(nested.join("copied.txt")).unwrap(), b"old file");
    assert_eq!(fs::read(external.join("copied.txt")).unwrap(), b"old file");
}

#[cfg(windows)]
#[test]
#[ignore = "requires STRATUM_TEST_MOVE_DESTINATION on a second volume"]
fn cross_volume_move_retains_new_source_files() {
    use crate::domain::filesystem::transfer::execute::transfer_entries;
    use crate::domain::filesystem::{TransferMode, TransferOptions, TransferProgressUpdate};

    let parent =
        std::env::var_os("STRATUM_TEST_MOVE_DESTINATION").expect("set a parent on a second volume");
    let target = TestDir::new(Path::new(&parent));
    let temp = TestDir::new(&std::env::temp_dir());
    let volume_id = |dir: &TestDir| {
        SourceFile::open(&dir.0, false)
            .unwrap()
            .identity()
            .unwrap()
            .0
    };
    assert_ne!(
        volume_id(&temp),
        volume_id(&target),
        "supply two different volumes"
    );
    let source = temp.0.join("source");
    fs::create_dir(&source).unwrap();
    let original = source.join("original.txt");
    fs::write(&original, b"copied").unwrap();
    let late = source.join("new.txt");
    let on_copy_start = original.to_string_lossy().into_owned();
    let mut progress = move |update: TransferProgressUpdate| {
        if update.current_path.as_deref() == Some(&on_copy_start) {
            fs::write(&late, b"new during copy").unwrap();
        }
    };
    let report = transfer_entries(
        vec![source.to_string_lossy().into_owned()],
        target.0.to_string_lossy().into_owned(),
        Some(TransferOptions {
            mode: Some(TransferMode::Move),
            ..Default::default()
        }),
        Some(&mut progress),
        None,
    )
    .unwrap();
    assert_eq!(report.failures.len(), 1, "{:?}", report.failures);
    assert_eq!(report.copied, 1);
    assert_eq!(report.moved, 0);
    assert!(report.moved_entries.is_empty());
    assert_eq!(
        fs::read(source.join("new.txt")).unwrap(),
        b"new during copy"
    );
    assert!(!original.exists());
    assert_eq!(
        fs::read(target.0.join("source/original.txt")).unwrap(),
        b"copied"
    );
    assert!(!target.0.join("source/new.txt").exists());

    let unchanged = temp.0.join("unchanged");
    fs::create_dir(&unchanged).unwrap();
    fs::write(unchanged.join("file.txt"), b"unchanged").unwrap();
    let report = transfer_entries(
        vec![unchanged.to_string_lossy().into_owned()],
        target.0.to_string_lossy().into_owned(),
        Some(TransferOptions {
            mode: Some(TransferMode::Move),
            ..Default::default()
        }),
        None,
        None,
    )
    .unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(report.moved, 1);
    assert_eq!(report.copied, 0);
    assert_eq!(report.moved_entries.len(), 1);
    assert!(!unchanged.exists());
    assert_eq!(
        fs::read(target.0.join("unchanged/file.txt")).unwrap(),
        b"unchanged"
    );
}
