use super::*;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "stratum-backup-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn writes_and_replaces_backups_without_leaving_staging_files() {
    let dir = TempDir::new();
    let file = dir.0.join("Profile.stratum.json");
    write_contents(&file, r#"{"workspace":"First"}"#).unwrap();
    assert_eq!(read_contents(&file).unwrap(), r#"{"workspace":"First"}"#);
    write_contents(&file, r#"{"workspace":"写真"}"#).unwrap();
    assert_eq!(read_contents(&file).unwrap(), r#"{"workspace":"写真"}"#);
    assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
}

#[test]
fn bounds_backup_reads_and_leaves_the_destination_on_a_failed_write() {
    let dir = TempDir::new();
    let oversized = dir.0.join("Large.stratum.json");
    File::create(&oversized)
        .unwrap()
        .set_len(MAX_BACKUP_BYTES + 1)
        .unwrap();
    assert!(read_contents(&oversized).unwrap_err().contains("16 MiB"));

    let existing = dir.0.join("Existing");
    fs::create_dir(&existing).unwrap();
    fs::write(existing.join("keep.txt"), b"keep me").unwrap();
    assert!(write_contents(&existing, "{}").is_err());
    assert_eq!(fs::read(existing.join("keep.txt")).unwrap(), b"keep me");
    assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 2);
}
