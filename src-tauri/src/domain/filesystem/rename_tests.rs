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
