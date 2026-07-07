// Root-level transfer strategy classification.
// This keeps cheap move/copy decisions separate from recursive manifest work so
// simple same-volume moves do not pay a full tree walk up front.
use super::common::{
    check_transfer_control, inspect_path, path_exists, path_is_same_or_within, same_drive,
};
use super::manifest::build_transfer_destination;
use crate::domain::filesystem::{TransferControlCallback, TransferMode};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub(crate) struct TransferRootStrategy {
    pub source: PathBuf,
    pub destination: PathBuf,
    pub should_move: bool,
    pub use_fast_move: bool,
}

pub(crate) fn classify_transfer_root(
    raw_path: &str,
    target_path: &Path,
    requested_mode: TransferMode,
    overwrite: bool,
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
    if inspection.kind.is_traversable_directory() && path_is_same_or_within(&destination, &source) {
        return Err("destination is inside source".to_string());
    }

    let should_move = match requested_mode {
        TransferMode::Copy => false,
        TransferMode::Move => true,
        TransferMode::Auto => same_drive(&source, target_path),
    };
    let use_fast_move =
        should_move && same_drive(&source, target_path) && !overwrite && !path_exists(&destination);

    Ok(Some(TransferRootStrategy {
        source,
        destination,
        should_move,
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
            TransferMode::Move,
            false,
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
            TransferMode::Move,
            false,
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
            TransferMode::Move,
            false,
            &mut on_control,
        )
        .expect_err("nested destination should be rejected");

        assert_eq!(error, "destination is inside source");
    }
}
