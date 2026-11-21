use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
        let path = std::env::temp_dir().join(format!(
            "stratum-rename-{}-{}",
            std::process::id(),
            now.as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    fn request(&self, source: &str, destination: &str) -> BatchRenameRequest {
        BatchRenameRequest {
            path: self.0.join(source).to_string_lossy().into_owned(),
            next_name: destination.into(),
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn validates_conflicts_in_row_order_including_selected_occupied_names() {
    let fixture = Fixture::new();
    for name in ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "occupied.txt"] {
        fixture.write(name, name.as_bytes());
    }

    let errors = validate_batch_rename(vec![
        fixture.request("a.txt", "b.txt"),
        fixture.request("b.txt", "free.txt"),
        fixture.request("c.txt", "duplicate.txt"),
        fixture.request("d.txt", "duplicate.txt"),
        fixture.request("e.txt", "occupied.txt"),
        fixture.request("missing.txt", "another.txt"),
    ]);
    assert_eq!(
        errors,
        [
            Some(OCCUPIED_NAME.into()),
            None,
            Some("More than one item would receive this name.".into()),
            Some("More than one item would receive this name.".into()),
            Some(OCCUPIED_NAME.into()),
            Some("The source no longer exists.".into()),
        ],
    );
    assert!(!fixture.0.join("free.txt").exists());
}

#[test]
fn reruns_destination_check_and_leaves_a_late_file_intact() {
    let fixture = Fixture::new();
    let source = fixture.write("source.txt", b"source");
    let request = fixture.request("source.txt", "destination.txt");
    assert_eq!(validate_batch_rename(vec![request]), [None]);

    let destination = fixture.write("destination.txt", b"late file");
    let source_path = source.to_string_lossy().into_owned();
    let error = rename_entry(source_path.clone(), "destination.txt".into()).unwrap_err();
    assert_eq!(error, OCCUPIED_NAME);
    assert_eq!(fs::read(&source).unwrap(), b"source");
    assert_eq!(fs::read(&destination).unwrap(), b"late file");

    let renamed = rename_entry(source_path, " new.txt".into()).unwrap();
    assert_eq!(Path::new(&renamed), fixture.0.join(" new.txt"));
    assert_eq!(fs::read(renamed).unwrap(), b"source");
}

#[cfg(windows)]
fn open_read_without_delete_share(path: &Path) -> fs::File {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

    fs::File::options()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
        .unwrap()
}

#[cfg(windows)]
#[test]
fn renames_three_files_when_a_read_handle_only_briefly_blocks_the_second() {
    use std::time::Duration;
    use windows_sys::Win32::Foundation::ERROR_SHARING_VIOLATION;

    let fixture = Fixture::new();
    let files = [
        (
            fixture.write("first.webp", b"first"),
            "one.webp",
            &b"first"[..],
        ),
        (
            fixture.write("second.webp", b"second"),
            "two.webp",
            &b"second"[..],
        ),
        (
            fixture.write("third.webp", b"third"),
            "three.webp",
            &b"third"[..],
        ),
    ];
    let blocker = open_read_without_delete_share(&files[1].0);
    let requests = files.iter().map(|(path, next_name, _)| BatchRenameRequest {
        path: path.to_string_lossy().into_owned(),
        next_name: (*next_name).into(),
    });
    assert_eq!(
        validate_batch_rename(requests.collect()),
        [None, None, None]
    );
    let error = staging::rename_new(&files[1].0, &fixture.0.join("two.webp")).unwrap_err();
    assert_eq!(error.raw_os_error(), Some(ERROR_SHARING_VIOLATION as i32));

    let (first, second, third) = (&files[0], &files[1], &files[2]);
    rename_entry(first.0.to_string_lossy().into_owned(), first.1.into()).unwrap();
    let release = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(120));
        drop(blocker);
    });
    let renamed = rename_entry(second.0.to_string_lossy().into_owned(), second.1.into());
    release.join().unwrap();
    renamed.unwrap();
    rename_entry(third.0.to_string_lossy().into_owned(), third.1.into()).unwrap();

    for (source, destination, bytes) in files {
        assert!(!source.exists());
        assert_eq!(fs::read(fixture.0.join(destination)).unwrap(), bytes);
    }
}

#[cfg(windows)]
#[test]
fn leaves_the_original_intact_when_the_file_stays_in_use() {
    let fixture = Fixture::new();
    let source = fixture.write("locked.webp", b"original");
    let lock = open_read_without_delete_share(&source);

    let error = rename_entry(source.to_string_lossy().into_owned(), "new.webp".into()).unwrap_err();
    assert!(error.contains("the item is still in use"), "{error}");
    assert_eq!(fs::read(&source).unwrap(), b"original");
    assert!(!fixture.0.join("new.webp").exists());

    drop(lock);
    let renamed = rename_entry(source.to_string_lossy().into_owned(), "new.webp".into()).unwrap();
    assert_eq!(fs::read(renamed).unwrap(), b"original");
}

#[cfg(windows)]
#[test]
fn checks_windows_names_and_distinguishes_case_only_changes() {
    let fixture = Fixture::new();
    let source = fixture.write("first.txt", b"first");
    fixture.write("second.txt", b"second");
    for invalid in [
        "CON.txt",
        "COM¹.txt",
        "name.",
        "name ",
        "ntfs:stream",
        "a*.txt",
    ] {
        let errors = validate_batch_rename(vec![fixture.request("first.txt", invalid)]);
        assert!(errors[0].is_some(), "accepted {invalid}");
    }

    let oversized = "😀".repeat(128);
    let errors = validate_batch_rename(vec![fixture.request("first.txt", &oversized)]);
    assert!(errors[0].is_some());

    let duplicate = validate_batch_rename(vec![
        fixture.request("first.txt", "same.txt"),
        fixture.request("second.txt", "Same.txt"),
    ]);
    assert!(duplicate.iter().all(Option::is_some));

    let case_only = validate_batch_rename(vec![fixture.request("first.txt", "First.txt")]);
    assert_eq!(
        case_only,
        [Some(
            "Batch rename cannot change only the letter case.".into()
        )],
    );
    let single = rename_entry(source.to_string_lossy().into_owned(), "First.txt".into()).unwrap();
    assert_eq!(Path::new(&single), source);
}
