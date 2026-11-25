// Trash/recycle helpers with Windows-specific recycle bin support.
use super::transfer::delete_discovery::DeleteDiscoveryPlan;
use super::{RestoreRecycleReport, TransferControlCallback, TransferProgressCallback, TrashReport};

#[cfg(target_os = "windows")]
use super::transfer::native_delete_windows::{shell_delete_entries, ShellDeleteMode};
#[cfg(target_os = "windows")]
mod receipts;
#[cfg(target_os = "windows")]
mod restore;

#[cfg(target_os = "windows")]
pub(crate) fn trash_entries(
    paths: Vec<String>,
    discovery: Option<&DeleteDiscoveryPlan>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<TrashReport, String> {
    let skipped = skipped_trash_paths(&paths);
    let report = shell_delete_entries(
        discovery,
        paths,
        ShellDeleteMode::Recycle,
        &mut on_progress,
        &mut on_control,
    )?;

    Ok(TrashReport {
        deleted: report.completed_paths.len(),
        skipped,
        cancelled: report.cancelled,
        failures: report.failures,
        failed_paths: report.remaining_paths,
        recycle_undo_receipt: receipts::issue(report.recycled_items),
    })
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn trash_entries(
    _paths: Vec<String>,
    _discovery: Option<&DeleteDiscoveryPlan>,
    _on_progress: Option<&mut TransferProgressCallback>,
    _on_control: Option<&mut TransferControlCallback>,
) -> Result<TrashReport, String> {
    Err("Native trash is only supported on Windows.".to_string())
}

fn skipped_trash_paths(paths: &[String]) -> usize {
    paths.iter().filter(|path| path.trim().is_empty()).count()
}

#[cfg(target_os = "windows")]
pub fn restore_recycle_items(receipt: String) -> Result<RestoreRecycleReport, String> {
    let mut report = RestoreRecycleReport {
        restored_paths: Vec::new(),
        failures: Vec::new(),
        can_retry: false,
    };
    let Some(entries) = receipts::take(&receipt) else {
        report.failures.push("This Recycle Bin undo record is no longer available. Open the Windows Recycle Bin to restore the items.".into());
        return Ok(report);
    };
    let mut remaining = Vec::new();
    for entry in entries {
        match restore::restore_entry(&entry) {
            Ok(()) => report.restored_paths.push(entry.original_path),
            Err(error) => {
                report
                    .failures
                    .push(format!("{}: {error}", entry.original_path));
                remaining.push(entry);
            }
        }
    }
    report.can_retry = receipts::remember(receipt, remaining);
    Ok(report)
}

#[cfg(not(target_os = "windows"))]
pub fn restore_recycle_items(_receipt: String) -> Result<RestoreRecycleReport, String> {
    Err("Recycle restore is only supported on Windows.".to_string())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::super::fs_recycle_windows::{normalize_recycle_path, RecycleEntry};
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::SystemTime;

    struct TestDirectory(PathBuf);

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn test_directory() -> TestDirectory {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("stratum-recycle-{}-{unique}", std::process::id()));
        fs::create_dir(&root).unwrap();
        TestDirectory(root)
    }

    fn fixture(root: &std::path::Path) -> (RecycleEntry, PathBuf) {
        let destination = root.join("original").join("photo.jpg");
        let recycle_folder = root.join("recycle-fixture").join("user");
        fs::create_dir_all(&recycle_folder).unwrap();
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        let data_path = recycle_folder.join("$Rphoto.jpg");
        let info_path = recycle_folder.join("$Iphoto.jpg");
        let original_path = normalize_recycle_path(destination.to_str().unwrap()).unwrap();
        let units: Vec<_> = original_path.encode_utf16().chain(Some(0)).collect();
        let mut record = Vec::new();
        record.extend(2u64.to_le_bytes());
        record.extend(8u64.to_le_bytes());
        record.extend(116_444_736_000_000_000u64.to_le_bytes());
        record.extend((units.len() as u32).to_le_bytes());
        record.extend(units.into_iter().flat_map(u16::to_le_bytes));
        fs::write(&info_path, record).unwrap();
        fs::write(&data_path, b"recycled").unwrap();
        (
            RecycleEntry::fixture(original_path, data_path, info_path).unwrap(),
            destination,
        )
    }

    #[test]
    fn recycle_restore_preserves_both_items_on_a_destination_collision() {
        let root = test_directory();
        let (entry, destination) = fixture(&root.0);
        fs::write(&destination, b"present").unwrap();
        assert!(restore::restore_entry(&entry).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"present");
        assert_eq!(fs::read(&entry.data_path).unwrap(), b"recycled");
        assert!(entry.info_path.is_file());

        fs::remove_file(&destination).unwrap();
        restore::restore_entry(&entry).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"recycled");
        assert!(!entry.data_path.exists());
        assert!(!entry.info_path.exists());
    }

    #[test]
    fn a_replaced_file_or_sidecar_cannot_be_restored_with_an_old_receipt() {
        for replace_info in [false, true] {
            let root = test_directory();
            let (entry, destination) = fixture(&root.0);
            let path = if replace_info {
                &entry.info_path
            } else {
                &entry.data_path
            };
            let original = path.with_extension("original");
            fs::rename(path, &original).unwrap();
            // Identical bytes at the same name are still a different filesystem object.
            fs::copy(&original, path).unwrap();
            let receipt = receipts::issue(vec![entry]).unwrap();
            let report = restore_recycle_items(receipt.clone()).unwrap();
            assert!(report.restored_paths.is_empty());
            assert!(!destination.exists());
            assert!(report.can_retry);
            assert!(receipts::take(&receipt).is_some());
        }
    }

    #[test]
    #[ignore = "uses the current Windows user's Recycle Bin for a disposable file"]
    fn recycle_undo_round_trips_a_disposable_windows_file() {
        let root = test_directory();
        let sibling = root.0.join("disposable-undo.txt");
        let path = root.0.join("disposable-undo.txt\u{a0}");
        fs::write(&sibling, b"unselected sibling").unwrap();
        fs::write(&path, b"Stratum recycle smoke test").unwrap();
        let original = normalize_recycle_path(path.to_str().unwrap()).unwrap();
        let trashed = trash_entries(vec![original.clone()], None, None, None).unwrap();
        assert_eq!(trashed.deleted, 1, "{:?}", trashed.failures);
        assert!(!path.exists());
        assert_eq!(fs::read(&sibling).unwrap(), b"unselected sibling");
        let receipt = trashed
            .recycle_undo_receipt
            .expect("Windows should expose an exact recycled item");
        let restored = restore_recycle_items(receipt.clone()).unwrap();
        assert_eq!(
            restored.restored_paths,
            vec![original],
            "{:?}",
            restored.failures
        );
        assert_eq!(fs::read(&path).unwrap(), b"Stratum recycle smoke test");
        let replay = restore_recycle_items(receipt).unwrap();
        assert!(!replay.can_retry && replay.restored_paths.is_empty());
    }
}
