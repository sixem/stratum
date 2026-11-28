// Root-level transfer strategy classification.
// This keeps cheap move/copy decisions separate from recursive manifest work so
// simple same-volume moves do not pay a full tree walk up front.
use super::common::{
    check_transfer_control, inspect_path, path_exists, path_is_same_or_within, same_drive,
    same_path,
};
use super::manifest::build_transfer_destination;
use crate::domain::filesystem::{TransferControlCallback, TransferMode, TransferOptions};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub(crate) struct TransferRootStrategy {
    pub kind: super::common::EntryKind,
    pub source: PathBuf,
    pub destination: PathBuf,
    pub should_move: bool,
    pub overwrite: bool,
    pub use_fast_move: bool,
}

pub(crate) fn classify_transfer_root(
    raw_path: &str,
    target_path: &Path,
    options: Option<&TransferOptions>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<Option<TransferRootStrategy>, String> {
    check_transfer_control(on_control)?;

    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let source = PathBuf::from(trimmed);
    let destination = match build_transfer_destination(&source, target_path) {
        Some(destination) => destination,
        None => return Ok(None),
    };
    let inspection = inspect_path(&source)?;
    if same_path(&source, &destination) {
        return Err("source and destination are the same".to_string());
    }
    if inspection.kind.is_traversable_directory() && path_is_same_or_within(&destination, &source) {
        return Err("destination is inside source".to_string());
    }
    if path_is_same_or_within(&source, &destination) {
        return Err("destination contains the source".to_string());
    }

    let should_move = match options
        .and_then(|value| value.mode)
        .unwrap_or(TransferMode::Auto)
    {
        TransferMode::Copy => false,
        TransferMode::Move => true,
        TransferMode::Auto => same_drive(&source, target_path),
    };
    // A list from the conflict prompt authorizes only destinations the user saw.
    // Older callers can still explicitly request a whole-job overwrite.
    let overwrite = match options.and_then(|value| value.overwrite_paths.as_ref()) {
        Some(paths) => paths.contains(&destination),
        None => options.and_then(|value| value.overwrite).unwrap_or(false),
    };
    let use_fast_move =
        should_move && same_drive(&source, target_path) && !overwrite && !path_exists(&destination);

    Ok(Some(TransferRootStrategy {
        kind: super::common::entry_kind_for_transfer_kind(inspection.kind),
        source,
        destination,
        should_move,
        overwrite,
        use_fast_move,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "stratum-transfer-strategy-test-{}-{}",
                std::process::id(),
                TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).expect("failed to create test directory");
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
    fn classify_transfer_root_marks_simple_same_volume_move_as_fast() {
        let temp = TestDir::new();
        let source = temp.path().join("alpha.txt");
        let destination_dir = temp.path().join("dest");
        fs::create_dir_all(&destination_dir).expect("failed to create destination directory");
        fs::write(&source, b"hello").expect("failed to create source file");

        let mut on_control: Option<&mut TransferControlCallback> = None;
        let strategy = classify_transfer_root(
            source.to_string_lossy().as_ref(),
            &destination_dir,
            None,
            &mut on_control,
        )
        .expect("strategy should classify")
        .expect("strategy should return a root");

        assert!(strategy.should_move);
        assert!(strategy.use_fast_move);
        assert_eq!(strategy.destination, destination_dir.join("alpha.txt"));
    }

    #[test]
    fn classify_transfer_root_uses_fallback_when_destination_exists() {
        let temp = TestDir::new();
        let source = temp.path().join("alpha.txt");
        let destination_dir = temp.path().join("dest");
        let destination = destination_dir.join("alpha.txt");
        fs::create_dir_all(&destination_dir).expect("failed to create destination directory");
        fs::write(&source, b"hello").expect("failed to create source file");
        fs::write(&destination, b"existing").expect("failed to create conflicting destination");

        let mut on_control: Option<&mut TransferControlCallback> = None;
        let strategy = classify_transfer_root(
            source.to_string_lossy().as_ref(),
            &destination_dir,
            None,
            &mut on_control,
        )
        .expect("strategy should classify")
        .expect("strategy should return a root");

        assert!(strategy.should_move);
        assert!(!strategy.use_fast_move);
    }

    #[test]
    fn classify_transfer_root_rejects_destination_inside_source() {
        let temp = TestDir::new();
        let source = temp.path().join("source");
        let nested_destination = source.join("nested");
        fs::create_dir_all(&nested_destination).expect("failed to create nested destination");

        let mut on_control: Option<&mut TransferControlCallback> = None;
        let error = classify_transfer_root(
            source.to_string_lossy().as_ref(),
            &nested_destination,
            None,
            &mut on_control,
        )
        .expect_err("nested destination should be rejected");

        assert_eq!(error, "destination is inside source");
    }

    #[test]
    fn approved_replace_leaves_a_later_unapproved_collision_intact() {
        use super::super::execute::transfer_entries;
        use crate::domain::filesystem::TransferProgressUpdate;

        let temp = TestDir::new();
        let target = temp.path().join("target");
        fs::create_dir(&target).unwrap();
        let approved = temp.path().join("approved.txt");
        let unapproved = temp.path().join("late.txt");
        fs::write(&approved, b"replacement").unwrap();
        fs::write(&unapproved, b"second source").unwrap();
        fs::write(target.join("approved.txt"), b"original").unwrap();
        let late = target.join("late.txt");
        let mut after_first_root = move |update: TransferProgressUpdate| {
            if update.processed == 1 && !late.exists() {
                fs::write(&late, b"arrived during transfer").unwrap();
            }
        };

        let options = serde_json::from_value(serde_json::json!({
            "mode": "copy",
            "overwritePaths": [target.join("approved.txt")]
        }))
        .unwrap();
        let report = transfer_entries(
            vec![approved, unapproved]
                .into_iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            target.to_string_lossy().into_owned(),
            Some(options),
            Some(&mut after_first_root),
            None,
        )
        .unwrap();

        assert_eq!(report.copied, 1);
        assert_eq!(report.failures.len(), 1);
        assert_eq!(
            fs::read(target.join("approved.txt")).unwrap(),
            b"replacement"
        );
        assert_eq!(
            fs::read(target.join("late.txt")).unwrap(),
            b"arrived during transfer"
        );
        assert_eq!(
            fs::read(temp.path().join("late.txt")).unwrap(),
            b"second source"
        );
    }

    #[test]
    fn replacing_a_file_with_itself_leaves_its_contents_and_reports_failure() {
        use super::super::execute::transfer_entries;

        let temp = TestDir::new();
        let source = temp.path().join("original.txt");
        fs::write(&source, b"original").unwrap();
        let report = transfer_entries(
            vec![source.to_string_lossy().into_owned()],
            temp.path().to_string_lossy().into_owned(),
            Some(TransferOptions {
                mode: Some(TransferMode::Move),
                overwrite_paths: Some([source.clone()].into_iter().collect()),
                ..Default::default()
            }),
            None,
            None,
        )
        .unwrap();

        assert_eq!(report.moved, 0);
        assert!(report.moved_entries.is_empty());
        assert_eq!(report.failures.len(), 1);
        assert_eq!(fs::read(source).unwrap(), b"original");
    }
}
