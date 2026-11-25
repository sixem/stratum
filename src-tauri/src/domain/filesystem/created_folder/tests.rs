use super::*;
use crate::domain::filesystem::{transfer_entries, TransferMode, TransferOptions};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

struct TempDirectory(PathBuf);

impl TempDirectory {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "stratum-created-folder-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn name(path: &Path) -> String {
    path.to_str().unwrap().to_owned()
}

fn guarded_move(
    paths: Vec<String>,
    destination: String,
    folder: CreatedFolder,
) -> Result<crate::domain::filesystem::TransferReport, String> {
    transfer_entries(
        paths,
        destination,
        Some(TransferOptions {
            mode: Some(TransferMode::Move),
            protected_folder: Some(folder),
            ..Default::default()
        }),
        None,
        None,
    )
}

#[test]
fn grouped_moves_are_reversible_and_cleanup_preserves_new_contents() {
    let root = TempDirectory::new();
    let parent = name(&root.0);
    assert!(create_tracked_folder(parent.clone(), "subdir/escape".into()).is_err());
    let folder = create_tracked_folder(parent.clone(), "Grouped".into()).unwrap();
    assert!(create_tracked_folder(parent.clone(), "Grouped".into()).is_err());
    let source = root.0.join("report.txt");
    fs::write(&source, b"test").unwrap();
    let grouped = Path::new(&folder.path);
    let conflicting = grouped.join("report.txt");
    fs::write(&conflicting, b"already here").unwrap();
    let rejected = guarded_move(vec![name(&source)], folder.path.clone(), folder.clone()).unwrap();
    assert_eq!(rejected.moved, 0);
    assert_eq!(rejected.failures.len(), 1);
    assert_eq!(fs::read(&conflicting).unwrap(), b"already here");
    fs::remove_file(conflicting).unwrap();
    let report = guarded_move(vec![name(&source)], folder.path.clone(), folder.clone()).unwrap();
    assert_eq!(report.moved, 1, "{:?}", report.failures);

    let extra = grouped.join("other.txt");
    fs::write(&extra, b"keep this").unwrap();
    let restored = guarded_move(
        vec![report.moved_entries[0].destination_path.clone()],
        parent,
        folder.clone(),
    )
    .unwrap();
    assert_eq!(restored.moved, 1, "{:?}", restored.failures);
    assert_eq!(fs::read(source).unwrap(), b"test");
    assert!(!remove_created_folder_if_empty(folder.clone()).unwrap());
    assert_eq!(fs::read(&extra).unwrap(), b"keep this");
    fs::remove_file(extra).unwrap();
    assert!(remove_created_folder_if_empty(folder.clone()).unwrap());
    assert!(!Path::new(&folder.path).exists());
}

#[test]
fn a_replacement_folder_cannot_be_used_as_an_undo_source_or_cleanup_target() {
    let root = TempDirectory::new();
    let parent = name(&root.0);
    let folder = create_tracked_folder(parent.clone(), "Grouped".into()).unwrap();
    fs::rename(&folder.path, root.0.join("Original")).unwrap();
    fs::create_dir(&folder.path).unwrap();
    assert!(!remove_created_folder_if_empty(folder.clone()).unwrap());
    let unrelated = Path::new(&folder.path).join("report.txt");
    fs::write(&unrelated, b"unrelated").unwrap();
    assert!(guarded_move(vec![name(&unrelated)], parent, folder).is_err());
    assert_eq!(fs::read(unrelated).unwrap(), b"unrelated");
}
