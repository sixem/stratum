// Exercise publication and cancellation through the same commands as paste and drag/drop.
use super::super::{common::TransferEntryKind, TRANSFER_CANCELLED_MESSAGE};
use super::{copy_entries, staging::TransferStage, transfer_entries};
use crate::domain::filesystem::{
    CopyOptions, CopyReport, TransferControlCallback, TransferMode, TransferOptions,
    TransferProgressCallback, TransferProgressUpdate,
};
use std::cell::Cell;
use std::fs;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

struct Fixture {
    root: PathBuf,
    source: PathBuf,
    target: PathBuf,
    destination: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "stratum-replace-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let source = root.join("item");
        let target = root.join("target");
        fs::create_dir(&target).unwrap();
        let destination = target.join("item");
        Self {
            root,
            source,
            target,
            destination,
        }
    }

    fn copy(
        &self,
        approve: bool,
        progress: Option<&mut TransferProgressCallback>,
        control: Option<&mut TransferControlCallback>,
    ) -> Result<CopyReport, String> {
        let options = approve.then(|| CopyOptions {
            overwrite_paths: Some(vec![self.destination.to_string_lossy().into_owned()]),
            skip_paths: None,
        });
        copy_entries(
            vec![self.source.to_string_lossy().into_owned()],
            self.target.to_string_lossy().into_owned(),
            options,
            progress,
            control,
        )
    }

    fn assert_no_stage(&self) {
        assert_eq!(fs::read_dir(&self.target).unwrap().count(), 1);
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn cancelling_file_or_subtree_replace_preserves_original_until_commit() {
    for directory in [false, true] {
        let f = Fixture::new();
        let source_file = if directory {
            fs::create_dir(&f.source).unwrap();
            f.source.join("child")
        } else {
            f.source.clone()
        };
        fs::write(source_file, vec![42u8; 128 * 1024]).unwrap();
        fs::write(&f.destination, b"original bytes").unwrap();
        let cancel = Rc::new(Cell::new(false));
        let trigger = cancel.clone();
        let original = f.destination.clone();
        let original_changed = Rc::new(Cell::new(false));
        let observed = original_changed.clone();
        let mut progress = move |update: TransferProgressUpdate| {
            if fs::read(&original).as_deref().ok() != Some(b"original bytes") {
                observed.set(true);
            }
            if update.current_bytes.unwrap_or(0) > 0 {
                trigger.set(true);
            }
        };
        let mut control = move || {
            if cancel.get() {
                Err(TRANSFER_CANCELLED_MESSAGE.to_owned())
            } else {
                Ok(())
            }
        };
        assert_eq!(
            f.copy(true, Some(&mut progress), Some(&mut control))
                .err()
                .as_deref(),
            Some(TRANSFER_CANCELLED_MESSAGE)
        );
        assert!(!original_changed.get());
        assert_eq!(fs::read(&f.destination).unwrap(), b"original bytes");
        f.assert_no_stage();
    }
}

#[test]
fn cancelled_move_batch_can_undo_only_its_committed_roots() {
    for cancel_between_roots in [true, false] {
        let f = Fixture::new();
        let second = f.root.join("second");
        fs::write(&f.source, b"first").unwrap();
        fs::write(&second, b"second").unwrap();

        let cancel = Rc::new(Cell::new(false));
        let trigger = cancel.clone();
        let mut progress = move |update: TransferProgressUpdate| {
            if update.processed == 1 && (cancel_between_roots || update.current_path.is_some()) {
                trigger.set(true);
            }
        };
        let mut control = move || {
            if cancel.get() {
                Err(TRANSFER_CANCELLED_MESSAGE.to_string())
            } else {
                Ok(())
            }
        };
        let report = transfer_entries(
            vec![
                f.source.to_str().unwrap().into(),
                second.to_str().unwrap().into(),
            ],
            f.target.to_str().unwrap().into(),
            None,
            Some(&mut progress),
            Some(&mut control),
        )
        .unwrap();

        assert!(report.cancelled);
        assert_eq!(report.moved, 1);
        assert!(report.failures.is_empty());
        let [entry] = report.moved_entries.as_slice() else {
            panic!("expected one Undo entry")
        };
        assert_eq!(entry.source_path, f.source.to_str().unwrap());
        assert_eq!(entry.destination_path, f.destination.to_str().unwrap());
        assert!(!f.source.exists());
        assert_eq!(fs::read(&second).unwrap(), b"second");
        f.assert_no_stage();

        let restored = transfer_entries(
            vec![entry.destination_path.clone()],
            f.root.to_str().unwrap().into(),
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(restored.moved, 1);
        assert!(!restored.cancelled);
        assert_eq!(fs::read(&f.source).unwrap(), b"first");
        assert!(!f.destination.exists());
    }
}

#[test]
fn late_unapproved_file_survives_publication() {
    let f = Fixture::new();
    fs::write(&f.source, b"incoming").unwrap();
    let destination = f.destination.clone();
    let mut progress = move |update: TransferProgressUpdate| {
        if update.current_path.is_some() {
            fs::write(&destination, b"new arrival").unwrap();
        }
    };
    let report = f.copy(false, Some(&mut progress), None).unwrap();
    assert_eq!(report.copied, 0);
    assert_eq!(report.failures.len(), 1);
    assert_eq!(fs::read(&f.destination).unwrap(), b"new arrival");
    f.assert_no_stage();
}

#[test]
fn cleanup_preserves_unrelated_files_in_the_staging_directory() {
    for cancel in [false, true] {
        let f = Fixture::new();
        fs::write(&f.source, b"incoming data").unwrap();
        fs::write(&f.destination, b"original").unwrap();
        let started = Rc::new(Cell::new(false));
        let signal = started.clone();
        let target = f.target.clone();
        let mut progress = move |update: TransferProgressUpdate| {
            if update.current_path.is_none() {
                return;
            }
            let stage = fs::read_dir(&target)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .find(|path| path.is_dir())
                .unwrap();
            fs::write(stage.join("other file"), b"keep this").unwrap();
            fs::write(stage.join("incoming/other file"), b"keep this too").unwrap();
            #[cfg(windows)]
            assert!(fs::rename(&stage, target.join("exchanged")).is_err());
            signal.set(true);
        };
        let mut control = move || {
            if cancel && started.get() {
                Err(TRANSFER_CANCELLED_MESSAGE.to_owned())
            } else {
                Ok(())
            }
        };
        let result = f.copy(true, Some(&mut progress), Some(&mut control));
        if cancel {
            assert_eq!(result.err().as_deref(), Some(TRANSFER_CANCELLED_MESSAGE));
            assert_eq!(fs::read(&f.destination).unwrap(), b"original");
        } else {
            assert!(result.unwrap().failures.is_empty());
            assert_eq!(fs::read(&f.destination).unwrap(), b"incoming data");
        }
        let stage = fs::read_dir(&f.target)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.is_dir())
            .unwrap();
        assert_eq!(fs::read(stage.join("other file")).unwrap(), b"keep this");
        assert_eq!(
            fs::read(stage.join("incoming/other file")).unwrap(),
            b"keep this too"
        );
        assert!(!stage.join("incoming/item").exists());
    }
}

#[test]
fn successful_copy_replaces_file_with_directory_and_directory_with_file() {
    let f = Fixture::new();
    fs::create_dir(&f.source).unwrap();
    fs::write(f.source.join("child"), b"new tree").unwrap();
    fs::write(&f.destination, b"old file").unwrap();
    let report = f.copy(true, None, None).unwrap();
    assert_eq!(report.copied, 1);
    assert!(report.failures.is_empty());
    assert_eq!(fs::read(f.destination.join("child")).unwrap(), b"new tree");
    fs::remove_dir_all(&f.source).unwrap();
    fs::write(&f.source, b"new file").unwrap();
    let report = f.copy(true, None, None).unwrap();
    assert_eq!(report.copied, 1);
    assert!(report.failures.is_empty());
    assert_eq!(fs::read(&f.destination).unwrap(), b"new file");
    f.assert_no_stage();
}

#[test]
fn failed_drag_replace_keeps_existing_directory_and_its_children() {
    let f = Fixture::new();
    fs::create_dir(&f.source).unwrap();
    let child = f.source.join("incoming");
    fs::write(&child, b"incoming").unwrap();
    fs::create_dir(&f.destination).unwrap();
    fs::write(f.destination.join("keep"), b"original").unwrap();
    let mut progress = move |update: TransferProgressUpdate| {
        if update.current_path.is_some() && child.exists() {
            fs::remove_file(&child).unwrap();
        }
    };
    let options = TransferOptions {
        mode: Some(TransferMode::Copy),
        overwrite: Some(true),
        ..Default::default()
    };
    let report = transfer_entries(
        vec![f.source.to_string_lossy().into_owned()],
        f.target.to_string_lossy().into_owned(),
        Some(options),
        Some(&mut progress),
        None,
    )
    .unwrap();
    assert_eq!(report.failures.len(), 1);
    assert_eq!(report.copied, 0);
    assert_eq!(fs::read(f.destination.join("keep")).unwrap(), b"original");
    assert!(!f.destination.join("incoming").exists());
    f.assert_no_stage();
}

#[test]
fn failed_directory_publication_restores_original_tree() {
    let f = Fixture::new();
    fs::create_dir(&f.destination).unwrap();
    fs::write(f.destination.join("keep"), b"original").unwrap();
    let mut stage = TransferStage::new(&f.destination).unwrap();
    let missing = stage.payload().unwrap();
    assert!(stage
        .publish(
            &missing,
            &f.destination,
            TransferEntryKind::Directory,
            Some(TransferEntryKind::Directory),
            &mut Vec::new()
        )
        .is_err());
    drop(stage);
    assert_eq!(fs::read(f.destination.join("keep")).unwrap(), b"original");
    f.assert_no_stage();
}

#[cfg(windows)]
#[test]
fn locked_destination_retains_original_bytes() {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

    let f = Fixture::new();
    fs::write(&f.source, b"incoming").unwrap();
    fs::write(&f.destination, b"old contents").unwrap();
    let lock = fs::File::options()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&f.destination)
        .unwrap();
    let report = f.copy(true, None, None).unwrap();
    assert_eq!(report.copied, 0);
    assert_eq!(report.failures.len(), 1);
    drop(lock);
    assert_eq!(fs::read(&f.destination).unwrap(), b"old contents");
    f.assert_no_stage();
}

#[test]
fn fast_move_refuses_a_destination_claimed_after_classification() {
    let f = Fixture::new();
    fs::write(&f.source, b"source").unwrap();
    let destination = f.destination.clone();
    let mut control =
        move || fs::write(&destination, b"late arrival").map_err(|err| err.to_string());
    assert!(super::transfer::execute_fast_move_root(
        &f.source,
        &f.destination,
        &mut Some(&mut control)
    )
    .is_err());
    assert_eq!(fs::read(&f.source).unwrap(), b"source");
    assert_eq!(fs::read(&f.destination).unwrap(), b"late arrival");
}

#[test]
fn paste_cannot_replace_its_own_containing_folder() {
    let f = Fixture::new();
    fs::create_dir(&f.destination).unwrap();
    let source = f.destination.join("item");
    fs::write(&source, b"original").unwrap();
    let options = CopyOptions {
        overwrite_paths: Some(vec![f.destination.to_string_lossy().into_owned()]),
        skip_paths: None,
    };
    let report = copy_entries(
        vec![source.to_string_lossy().into_owned()],
        f.target.to_string_lossy().into_owned(),
        Some(options),
        None,
        None,
    )
    .unwrap();
    assert_eq!(report.failures.len(), 1);
    assert_eq!(fs::read(source).unwrap(), b"original");
    f.assert_no_stage();
}

#[cfg(windows)]
#[test]
fn cancel_drops_already_copied_readonly_children_and_keeps_source_attributes() {
    let f = Fixture::new();
    fs::create_dir(&f.source).unwrap();
    for name in ["first", "second"] {
        let path = f.source.join(name);
        fs::write(&path, name).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions).unwrap();
    }
    fs::write(&f.destination, b"old").unwrap();
    let cancelled = Rc::new(Cell::new(false));
    let trigger = cancelled.clone();
    let mut files_started = 0;
    let mut progress = move |update: TransferProgressUpdate| {
        if update.current_path.is_some() && update.current_bytes == Some(0) {
            files_started += 1;
            if files_started == 2 {
                trigger.set(true);
            }
        }
    };
    let mut control = move || {
        if cancelled.get() {
            Err(TRANSFER_CANCELLED_MESSAGE.to_owned())
        } else {
            Ok(())
        }
    };
    assert_eq!(
        f.copy(true, Some(&mut progress), Some(&mut control))
            .err()
            .as_deref(),
        Some(TRANSFER_CANCELLED_MESSAGE)
    );
    assert_eq!(fs::read(&f.destination).unwrap(), b"old");
    assert!(fs::metadata(f.source.join("first"))
        .unwrap()
        .permissions()
        .readonly());
    assert!(fs::metadata(f.source.join("second"))
        .unwrap()
        .permissions()
        .readonly());
    f.assert_no_stage();
}

#[cfg(windows)]
#[test]
fn native_copy_preserves_distinct_ntfs_child_names() {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    let f = Fixture::new();
    fs::create_dir(&f.source).unwrap();
    let surrogate = OsString::from_wide(&[0x61, 0xd800]);
    let replacement = "a\u{fffd}";
    fs::write(f.source.join(&surrogate), b"surrogate").unwrap();
    fs::write(f.source.join(replacement), b"replacement").unwrap();
    let report = f.copy(false, None, None).unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(
        fs::read(f.destination.join(surrogate)).unwrap(),
        b"surrogate"
    );
    assert_eq!(
        fs::read(f.destination.join(replacement)).unwrap(),
        b"replacement"
    );
    f.assert_no_stage();
}

#[cfg(windows)]
#[test]
#[ignore = "writes a disposable 64 MiB file to exercise native mid-copy cancellation"]
fn cancel_native_replace_after_an_intermediate_chunk() {
    use std::io::Write;

    let f = Fixture::new();
    let mut source = fs::File::create(&f.source).unwrap();
    let chunk = vec![0x57; 1024 * 1024];
    for _ in 0..64 {
        source.write_all(&chunk).unwrap();
    }
    drop(source);
    fs::write(&f.destination, b"original contents").unwrap();
    let intermediate = Rc::new(Cell::new(0u64));
    let observed = intermediate.clone();
    let mut progress = move |update: TransferProgressUpdate| {
        if let (Some(bytes), Some(total)) = (update.current_bytes, update.current_total_bytes) {
            if bytes > 0 && bytes < total {
                observed.set(bytes);
            }
        }
    };
    let trigger = intermediate.clone();
    let mut control = move || {
        if trigger.get() > 0 {
            Err(TRANSFER_CANCELLED_MESSAGE.to_owned())
        } else {
            Ok(())
        }
    };
    assert_eq!(
        f.copy(true, Some(&mut progress), Some(&mut control))
            .err()
            .as_deref(),
        Some(TRANSFER_CANCELLED_MESSAGE)
    );
    assert!(intermediate.get() > 0 && intermediate.get() < 64 * 1024 * 1024);
    eprintln!("Cancelled after {} of 67108864 bytes", intermediate.get());
    assert_eq!(fs::read(&f.destination).unwrap(), b"original contents");
    assert_eq!(fs::metadata(&f.source).unwrap().len(), 64 * 1024 * 1024);
    f.assert_no_stage();
}

#[cfg(windows)]
#[test]
fn replaced_directory_cleanup_leaves_junction_target_alone() {
    let f = Fixture::new();
    fs::write(&f.source, b"replacement").unwrap();
    fs::create_dir(&f.destination).unwrap();
    let external = f.root.join("external");
    fs::create_dir(&external).unwrap();
    fs::write(external.join("keep"), b"junction target").unwrap();
    let command = std::process::Command::new("cmd.exe")
        .args(["/d", "/c", "mklink", "/j", r"target\item\link", "external"])
        .current_dir(&f.root)
        .output()
        .unwrap();
    assert!(
        command.status.success(),
        "{}",
        String::from_utf8_lossy(&command.stderr)
    );
    assert_eq!(
        fs::read(f.destination.join("link/keep")).unwrap(),
        b"junction target"
    );
    let report = f.copy(true, None, None).unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(fs::read(external.join("keep")).unwrap(), b"junction target");
    assert_eq!(fs::read(&f.destination).unwrap(), b"replacement");
    f.assert_no_stage();
}
