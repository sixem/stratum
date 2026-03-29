// Shared delete/recycle discovery for Windows work-queue jobs.
// This walks requested roots without following directory symlinks/reparse points
// so the app can surface immediate planning feedback before shell execution.
use super::common::{check_transfer_control, inspect_path};
use crate::domain::filesystem::TransferControlCallback;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default)]
pub(crate) struct DeleteDiscoveryRoot {
    pub path: String,
    pub item_count: usize,
    pub byte_count: u64,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct DeleteDiscoveryPlan {
    pub roots: Vec<DeleteDiscoveryRoot>,
    pub item_count: usize,
    pub byte_count: u64,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct DeleteDiscoveryProgress {
    pub discovered_items: usize,
    pub discovered_bytes: u64,
    pub current_path: Option<String>,
}

pub(crate) type DeleteDiscoveryProgressCallback = dyn FnMut(DeleteDiscoveryProgress);

pub(crate) fn discover_delete_plan(
    paths: &[String],
    mut on_progress: Option<&mut DeleteDiscoveryProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
) -> Result<DeleteDiscoveryPlan, String> {
    let mut plan = DeleteDiscoveryPlan::default();

    for raw_path in paths {
        check_transfer_control(&mut on_control)?;
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            continue;
        }

        let target = PathBuf::from(trimmed);
        let mut root = DeleteDiscoveryRoot {
            path: trimmed.to_string(),
            item_count: 1,
            byte_count: 0,
        };

        if let Ok(inspection) = inspect_path(&target) {
            root.byte_count = root
                .byte_count
                .saturating_add(inspection.kind.byte_count(&inspection.metadata));
            emit_progress(
                &mut on_progress,
                plan.item_count.saturating_add(root.item_count),
                plan.byte_count.saturating_add(root.byte_count),
                Some(trimmed.to_string()),
            );

            if inspection.kind.is_traversable_directory() {
                collect_delete_directory(
                    &target,
                    plan.item_count,
                    plan.byte_count,
                    &mut root,
                    &mut on_progress,
                    &mut on_control,
                )?;
            }
        } else {
            emit_progress(
                &mut on_progress,
                plan.item_count.saturating_add(root.item_count),
                plan.byte_count.saturating_add(root.byte_count),
                Some(trimmed.to_string()),
            );
        }

        plan.item_count = plan.item_count.saturating_add(root.item_count);
        plan.byte_count = plan.byte_count.saturating_add(root.byte_count);
        plan.roots.push(root);
    }

    Ok(plan)
}

fn collect_delete_directory(
    root: &Path,
    base_items: usize,
    base_bytes: u64,
    discovered_root: &mut DeleteDiscoveryRoot,
    on_progress: &mut Option<&mut DeleteDiscoveryProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries {
        check_transfer_control(on_control)?;
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let path = entry.path();
        let current_path = path.to_string_lossy().to_string();
        discovered_root.item_count = discovered_root.item_count.saturating_add(1);

        let inspection = match inspect_path(&path) {
            Ok(inspection) => inspection,
            Err(_) => {
                emit_progress(
                    on_progress,
                    base_items.saturating_add(discovered_root.item_count),
                    base_bytes.saturating_add(discovered_root.byte_count),
                    Some(current_path.clone()),
                );
                continue;
            }
        };
        discovered_root.byte_count = discovered_root
            .byte_count
            .saturating_add(inspection.kind.byte_count(&inspection.metadata));
        emit_progress(
            on_progress,
            base_items.saturating_add(discovered_root.item_count),
            base_bytes.saturating_add(discovered_root.byte_count),
            Some(current_path.clone()),
        );

        if inspection.kind.is_traversable_directory() {
            collect_delete_directory(
                &path,
                base_items,
                base_bytes,
                discovered_root,
                on_progress,
                on_control,
            )?;
        }
    }

    Ok(())
}

fn emit_progress(
    on_progress: &mut Option<&mut DeleteDiscoveryProgressCallback>,
    discovered_items: usize,
    discovered_bytes: u64,
    current_path: Option<String>,
) {
    let Some(callback) = on_progress.as_mut() else {
        return;
    };

    callback(DeleteDiscoveryProgress {
        discovered_items,
        discovered_bytes,
        current_path,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "stratum-delete-discovery-test-{}-{}",
                std::process::id(),
                TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).expect("failed to create test directory");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn discover_delete_plan_counts_roots_files_and_directories() {
        let temp = TestDir::new();
        let source_root = temp.path().join("source");
        let nested_dir = source_root.join("nested");
        fs::create_dir_all(&nested_dir).expect("failed to create nested directory");
        fs::write(source_root.join("alpha.txt"), b"abc").expect("failed to write alpha file");
        fs::write(nested_dir.join("beta.txt"), b"hello").expect("failed to write beta file");

        let paths = vec![source_root.to_string_lossy().to_string()];
        let plan =
            discover_delete_plan(&paths, None, None).expect("delete discovery should succeed");

        assert_eq!(plan.roots.len(), 1);
        assert_eq!(plan.item_count, 4);
        assert_eq!(plan.byte_count, 8);
        assert_eq!(plan.roots[0].item_count, 4);
        assert_eq!(plan.roots[0].byte_count, 8);
    }
}
