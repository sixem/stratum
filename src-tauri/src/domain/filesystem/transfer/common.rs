// Shared transfer helpers used by both planning and execution.
// These keep path handling and overwrite/skip decisions in one place.
use crate::domain::filesystem::{
    CopyOptions, TransferControlCallback, TransferProgressCallback, TransferProgressUpdate,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

// Chunk size for streaming file copies while emitting progress updates.
pub(crate) const COPY_CHUNK_SIZE: usize = 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryKind {
    File,
    Directory,
}

#[derive(Default)]
pub(crate) struct CopyExecution {
    pub copied_root: bool,
    pub skipped: usize,
}

pub(crate) struct CopyDecisionSets {
    pub overwrite_paths: HashSet<String>,
    pub skip_paths: HashSet<String>,
}

pub(crate) fn unique_destination(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = match path.parent() {
        Some(parent) => parent,
        None => return path.to_path_buf(),
    };
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("item");
    let ext = path.extension().and_then(|value| value.to_str());

    for index in 1..=10_000 {
        let candidate = match ext {
            Some(ext) => format!("{} ({}).{}", stem, index, ext),
            None => format!("{} ({})", stem, index),
        };
        let candidate_path = parent.join(candidate);
        if !candidate_path.exists() {
            return candidate_path;
        }
    }

    path.to_path_buf()
}

pub(crate) fn normalize_path_key(path: &Path) -> String {
    normalize_path_string(&path.to_string_lossy())
}

pub(crate) fn normalize_path_string(value: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        value.replace('/', "\\").to_lowercase()
    }

    #[cfg(not(target_os = "windows"))]
    {
        value.to_string()
    }
}

pub(crate) fn same_path(left: &Path, right: &Path) -> bool {
    normalize_path_key(left) == normalize_path_key(right)
}

pub(crate) fn is_same_directory_copy(src: &Path, destination_dir: &Path) -> bool {
    match src.parent() {
        Some(parent) => same_path(parent, destination_dir),
        None => false,
    }
}

pub(crate) fn entry_kind_for_metadata(metadata: &fs::Metadata) -> EntryKind {
    if metadata.is_dir() {
        EntryKind::Directory
    } else {
        EntryKind::File
    }
}

pub(crate) fn destination_kind(
    path: &Path,
    planned: &HashMap<String, EntryKind>,
) -> Result<Option<EntryKind>, String> {
    if path.exists() {
        let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
        return Ok(Some(entry_kind_for_metadata(&metadata)));
    }

    Ok(planned.get(&normalize_path_key(path)).copied())
}

pub(crate) fn build_copy_decision_sets(options: Option<&CopyOptions>) -> CopyDecisionSets {
    let overwrite_paths = options
        .and_then(|value| value.overwrite_paths.as_ref())
        .map(|paths| {
            paths
                .iter()
                .map(|value| normalize_path_string(value))
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let skip_paths = options
        .and_then(|value| value.skip_paths.as_ref())
        .map(|paths| {
            paths
                .iter()
                .map(|value| normalize_path_string(value))
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();

    CopyDecisionSets {
        overwrite_paths,
        skip_paths,
    }
}

pub(crate) fn should_skip_copy_destination(dest: &Path, decisions: &CopyDecisionSets) -> bool {
    decisions.skip_paths.contains(&normalize_path_key(dest))
}

pub(crate) fn should_overwrite_copy_destination(dest: &Path, decisions: &CopyDecisionSets) -> bool {
    decisions
        .overwrite_paths
        .contains(&normalize_path_key(dest))
}

pub(crate) fn emit_transfer_progress(
    callback: &mut Option<&mut TransferProgressCallback>,
    update: TransferProgressUpdate,
) {
    if let Some(handler) = callback.as_mut() {
        handler(update);
    }
}

pub(crate) fn check_transfer_control(
    callback: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    if let Some(handler) = callback.as_mut() {
        handler()?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn drive_key(path: &Path) -> Option<String> {
    use std::path::Component;
    use std::path::Prefix;

    let component = path.components().next()?;
    if let Component::Prefix(prefix) = component {
        return match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                Some(format!("{}:", char::from(letter).to_ascii_uppercase()))
            }
            Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => Some(format!(
                "\\\\{}\\{}",
                server.to_string_lossy(),
                share.to_string_lossy()
            )),
            _ => None,
        };
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn drive_key(path: &Path) -> Option<String> {
    if path.is_absolute() {
        Some("/".to_string())
    } else {
        None
    }
}

pub(crate) fn same_drive(left: &Path, right: &Path) -> bool {
    let left_key = drive_key(left);
    let right_key = drive_key(right);
    match (left_key, right_key) {
        (Some(l), Some(r)) => l.eq_ignore_ascii_case(&r),
        _ => false,
    }
}

pub(crate) fn remove_existing(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let result = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|err| err.to_string())
}
