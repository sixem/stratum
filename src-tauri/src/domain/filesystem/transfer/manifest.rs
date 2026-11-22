// Builds flat transfer manifests for copy and move execution.
// The executor walks these manifests in order so it can stay predictable and
// avoid rediscovering path kinds during the hot copy loop.
use super::common::{
    check_transfer_control, inspect_path, is_same_directory_copy, unique_destination,
    TransferEntryKind,
};
use crate::domain::filesystem::TransferControlCallback;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub(crate) struct TransferManifestEntry {
    pub source: PathBuf,
    pub destination: PathBuf,
    pub kind: TransferEntryKind,
    pub bytes_total: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct TransferManifestRoot {
    pub source: PathBuf,
    pub destination: PathBuf,
    pub kind: TransferEntryKind,
    pub entries: Vec<TransferManifestEntry>,
    pub file_count: usize,
    pub byte_count: u64,
}

#[derive(Default)]
pub(crate) struct TransferManifestWork {
    pub file_count: usize,
    pub byte_count: u64,
}

pub(crate) fn validate_destination(destination: &str) -> Result<PathBuf, String> {
    let target = destination.trim();
    if target.is_empty() {
        return Err("Empty destination".to_string());
    }
    let target_path = PathBuf::from(target);
    // In particular, Windows would resolve "C:" against the drive's working directory.
    if !target_path.is_absolute() {
        return Err("Destination must be an absolute path".to_string());
    }
    let metadata =
        fs::metadata(&target_path).map_err(|_| "Destination does not exist".to_string())?;
    if !metadata.is_dir() {
        return Err("Destination is not a folder".to_string());
    }
    Ok(target_path)
}

pub(crate) fn requested_roots(paths: &[String]) -> usize {
    paths
        .iter()
        .filter(|value| !value.trim().is_empty())
        .count()
}

pub(crate) fn build_copy_destination(src: &Path, target_path: &Path) -> Option<PathBuf> {
    let name = src.file_name()?;
    let default_dest = target_path.join(name);
    if is_same_directory_copy(src, target_path) {
        return Some(unique_destination(&default_dest));
    }
    Some(default_dest)
}

pub(crate) fn build_transfer_destination(src: &Path, target_path: &Path) -> Option<PathBuf> {
    let name = src.file_name()?;
    Some(target_path.join(name))
}

pub(crate) fn build_manifest_root(
    src: &Path,
    dest: &Path,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<TransferManifestRoot, String> {
    let mut entries = Vec::new();
    let (kind, work) = walk_manifest(
        src,
        Some(dest),
        on_control,
        |source, destination, kind, bytes_total| {
            let destination = destination.expect("manifest construction supplies a destination");
            entries.push(TransferManifestEntry {
                source: source.to_path_buf(),
                destination: destination.to_path_buf(),
                kind,
                bytes_total,
            });
        },
    )?;

    Ok(TransferManifestRoot {
        source: src.to_path_buf(),
        destination: dest.to_path_buf(),
        kind,
        entries,
        file_count: work.file_count,
        byte_count: work.byte_count,
    })
}

pub(crate) fn estimate_manifest_work(
    source: &Path,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<TransferManifestWork, String> {
    // Planning needs only the totals. Resolve destinations again when executing.
    walk_manifest(source, None, on_control, |_, _, _, _| {}).map(|(_, work)| work)
}

fn walk_manifest(
    source: &Path,
    destination: Option<&Path>,
    on_control: &mut Option<&mut TransferControlCallback>,
    mut visit: impl FnMut(&Path, Option<&Path>, TransferEntryKind, u64),
) -> Result<(TransferEntryKind, TransferManifestWork), String> {
    check_transfer_control(on_control)?;
    let root = inspect_path(source)?;
    let mut work = TransferManifestWork::default();
    let mut count_and_visit =
        |path: &Path, target: Option<&Path>, kind: TransferEntryKind, metadata: &fs::Metadata| {
            let bytes = kind.byte_count(metadata);
            if kind.counts_as_file() {
                work.file_count = work.file_count.saturating_add(1);
                work.byte_count = work.byte_count.saturating_add(bytes);
            }
            visit(path, target, kind, bytes);
        };
    count_and_visit(source, destination, root.kind, &root.metadata);
    if root.kind.is_traversable_directory() {
        walk_directory_entries(source, destination, &mut count_and_visit, on_control)?;
    }
    Ok((root.kind, work))
}

fn walk_directory_entries(
    src_dir: &Path,
    dest_dir: Option<&Path>,
    visit: &mut impl FnMut(&Path, Option<&Path>, TransferEntryKind, &fs::Metadata),
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    for entry in fs::read_dir(src_dir).map_err(|err| err.to_string())? {
        check_transfer_control(on_control)?;
        let entry = entry.map_err(|err| err.to_string())?;
        let child_src = entry.path();
        let child_dest = dest_dir.map(|dir| dir.join(entry.file_name()));
        let inspection = inspect_path(&child_src)?;

        visit(
            &child_src,
            child_dest.as_deref(),
            inspection.kind,
            &inspection.metadata,
        );

        if inspection.kind.is_traversable_directory() {
            walk_directory_entries(&child_src, child_dest.as_deref(), visit, on_control)?;
        }
    }

    Ok(())
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
                "stratum-transfer-manifest-test-{}-{}",
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

    #[cfg(windows)]
    #[test]
    fn validate_destination_requires_an_absolute_directory() {
        for relative in ["C:", r"C:folder", r"\folder", "."] {
            assert_eq!(
                validate_destination(relative).unwrap_err(),
                "Destination must be an absolute path"
            );
        }

        let temp = TestDir::new();
        let root = temp.path().ancestors().last().unwrap();
        for absolute in [root, temp.path()] {
            assert_eq!(
                validate_destination(absolute.to_str().unwrap()).unwrap(),
                absolute
            );
        }
    }

    #[test]
    fn requested_roots_skips_blank_entries() {
        let roots = requested_roots(&[
            "".to_string(),
            "   ".to_string(),
            "C:/source-a".to_string(),
            "C:/source-b".to_string(),
        ]);

        assert_eq!(roots, 2);
    }

    #[test]
    fn build_copy_destination_uses_unique_name_for_same_directory_copy() {
        let temp = TestDir::new();
        let source = temp.path().join("report.txt");
        fs::write(&source, b"hello").expect("failed to create source file");

        let destination =
            build_copy_destination(&source, temp.path()).expect("destination should resolve");
        assert_eq!(
            destination.file_name().and_then(|name| name.to_str()),
            Some("report (1).txt")
        );
    }

    #[test]
    fn build_manifest_root_counts_directory_files_once() {
        let temp = TestDir::new();
        let source_root = temp.path().join("source");
        let nested_dir = source_root.join("nested");
        fs::create_dir_all(&nested_dir).expect("failed to create nested directory");
        fs::write(source_root.join("alpha.txt"), b"abc").expect("failed to write alpha file");
        fs::write(nested_dir.join("beta.txt"), b"hello").expect("failed to write beta file");

        let destination_root = temp.path().join("destination");
        let mut on_control: Option<&mut TransferControlCallback> = None;
        let manifest = build_manifest_root(&source_root, &destination_root, &mut on_control)
            .expect("manifest should build");
        let estimated = estimate_manifest_work(&source_root, &mut on_control)
            .expect("work estimate should scan the same entries");

        assert_eq!(manifest.kind, TransferEntryKind::Directory);
        assert_eq!(manifest.file_count, 2);
        assert_eq!(manifest.byte_count, 8);
        assert_eq!(estimated.file_count, manifest.file_count);
        assert_eq!(estimated.byte_count, manifest.byte_count);
        assert_eq!(manifest.entries.len(), 4);
        assert_eq!(manifest.entries[0].destination, destination_root);
        assert!(manifest
            .entries
            .iter()
            .any(|entry| entry.destination == destination_root.join("nested").join("beta.txt")));
    }
}
