// Shared transfer helpers used by both planning and execution.
// These keep Windows-specific path safety, conflict decisions, and progress
// plumbing in one place so the higher-level transfer code stays readable.
use crate::domain::filesystem::{
    CopyOptions, TransferControlCallback, TransferProgressCallback, TransferProgressUpdate,
};
use std::collections::{HashMap, HashSet};
#[cfg(target_os = "windows")]
use std::ffi::OsStr;
use std::fs;
#[cfg(target_os = "windows")]
use std::iter::once;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use std::os::windows::fs::{FileTypeExt, MetadataExt};
#[cfg(target_os = "windows")]
use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

// Chunk size for the non-Windows/manual fallback copy loop.
#[cfg(not(target_os = "windows"))]
pub(crate) const COPY_CHUNK_SIZE: usize = 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryKind {
    File,
    Directory,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TransferEntryKind {
    File,
    Directory,
    SymlinkFile,
    SymlinkDirectory,
    ReparseFile,
    ReparseDirectory,
}

impl TransferEntryKind {
    pub(crate) fn is_traversable_directory(self) -> bool {
        matches!(self, Self::Directory)
    }

    pub(crate) fn is_directory_like(self) -> bool {
        matches!(
            self,
            Self::Directory | Self::SymlinkDirectory | Self::ReparseDirectory
        )
    }

    pub(crate) fn counts_as_file(self) -> bool {
        !matches!(self, Self::Directory)
    }

    pub(crate) fn byte_count(self, metadata: &fs::Metadata) -> u64 {
        if matches!(self, Self::File) {
            metadata.len()
        } else {
            0
        }
    }
}

pub(crate) struct PathInspection {
    pub metadata: fs::Metadata,
    pub kind: TransferEntryKind,
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

pub(crate) fn path_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

pub(crate) fn unique_destination(path: &Path) -> PathBuf {
    if !path_exists(path) {
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
        if !path_exists(&candidate_path) {
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

pub(crate) fn path_is_same_or_within(path: &Path, root: &Path) -> bool {
    let path_key = normalize_path_key(path);
    let root_key = normalize_path_key(root);
    if path_key == root_key {
        return true;
    }

    let mut root_prefix = root_key;
    if !root_prefix.ends_with('\\') && !root_prefix.ends_with('/') {
        root_prefix.push(std::path::MAIN_SEPARATOR);
    }
    path_key.starts_with(&root_prefix)
}

pub(crate) fn is_same_directory_copy(src: &Path, destination_dir: &Path) -> bool {
    match src.parent() {
        Some(parent) => same_path(parent, destination_dir),
        None => false,
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn windows_extended_path(path: &Path) -> Result<Vec<u16>, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|err| err.to_string())?
            .join(path)
    };

    let raw = absolute.to_string_lossy().replace('/', "\\");
    let extended = if raw.starts_with(r"\\?\") {
        raw
    } else if raw.starts_with(r"\\") {
        format!(r"\\?\UNC\{}", raw.trim_start_matches('\\'))
    } else {
        format!(r"\\?\{raw}")
    };

    Ok(OsStr::new(&extended).encode_wide().chain(once(0)).collect())
}

#[cfg(target_os = "windows")]
fn transfer_entry_kind_from_metadata_windows(metadata: &fs::Metadata) -> TransferEntryKind {
    let file_type = metadata.file_type();
    if file_type.is_symlink_dir() {
        return TransferEntryKind::SymlinkDirectory;
    }
    if file_type.is_symlink_file() {
        return TransferEntryKind::SymlinkFile;
    }

    let is_reparse = metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0;
    if is_reparse && metadata.is_dir() {
        return TransferEntryKind::ReparseDirectory;
    }
    if is_reparse {
        return TransferEntryKind::ReparseFile;
    }
    if metadata.is_dir() {
        return TransferEntryKind::Directory;
    }
    TransferEntryKind::File
}

pub(crate) fn inspect_path(path: &Path) -> Result<PathInspection, String> {
    let metadata = fs::symlink_metadata(path).map_err(|err| err.to_string())?;

    #[cfg(target_os = "windows")]
    let kind = transfer_entry_kind_from_metadata_windows(&metadata);

    #[cfg(not(target_os = "windows"))]
    let kind = {
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            match fs::metadata(path) {
                Ok(target_metadata) if target_metadata.is_dir() => {
                    TransferEntryKind::SymlinkDirectory
                }
                _ => TransferEntryKind::SymlinkFile,
            }
        } else if metadata.is_dir() {
            TransferEntryKind::Directory
        } else {
            TransferEntryKind::File
        }
    };

    Ok(PathInspection { metadata, kind })
}

pub(crate) fn entry_kind_for_transfer_kind(kind: TransferEntryKind) -> EntryKind {
    if matches!(kind, TransferEntryKind::Directory) {
        EntryKind::Directory
    } else {
        EntryKind::File
    }
}

pub(crate) fn destination_kind(
    path: &Path,
    planned: &HashMap<String, EntryKind>,
) -> Result<Option<EntryKind>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            #[cfg(target_os = "windows")]
            let kind =
                entry_kind_for_transfer_kind(transfer_entry_kind_from_metadata_windows(&metadata));

            #[cfg(not(target_os = "windows"))]
            let kind = if metadata.is_dir() {
                EntryKind::Directory
            } else {
                EntryKind::File
            };

            Ok(Some(kind))
        }
        Err(_) => Ok(planned.get(&normalize_path_key(path)).copied()),
    }
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

pub(crate) fn remove_path_by_kind(path: &Path, kind: TransferEntryKind) -> Result<(), String> {
    let result = match kind {
        TransferEntryKind::Directory => fs::remove_dir_all(path),
        TransferEntryKind::SymlinkDirectory | TransferEntryKind::ReparseDirectory => {
            fs::remove_dir(path)
        }
        TransferEntryKind::File
        | TransferEntryKind::SymlinkFile
        | TransferEntryKind::ReparseFile => fs::remove_file(path),
    };
    result.map_err(|err| err.to_string())
}
