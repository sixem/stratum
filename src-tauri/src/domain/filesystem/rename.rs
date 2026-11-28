// Plan and validate same-directory renames before updating the filesystem.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::{
    file_identity::{rename_verified, EntryIdentity, ObservedEntry},
    staging,
    transfer::normalize_path_key,
};

const OCCUPIED_NAME: &str = "A file or folder with that name already exists.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRenameRequest {
    pub path: String,
    pub next_name: String,
}

struct RenamePaths {
    source: PathBuf,
    destination: PathBuf,
}

fn rename_paths(path: &str, name: &str) -> Result<RenamePaths, String> {
    if path.trim().is_empty() {
        return Err("The source path is empty.".into());
    }
    if name.trim().is_empty() {
        return Err("Enter a new name.".into());
    }
    if name.contains(['/', '\\']) {
        return Err("A name cannot contain path separators.".into());
    }
    if matches!(name, "." | "..") || name.contains('\0') {
        return Err("Enter a valid name.".into());
    }
    #[cfg(windows)]
    {
        use crate::platform::windows::file_names::plain_component;
        if name.encode_utf16().count() > 255 {
            return Err("The name is too long for Windows.".into());
        }
        if !plain_component(name) {
            return Err("This name is invalid or reserved on Windows.".into());
        }
    }

    let source = PathBuf::from(path);
    let parent = source
        .parent()
        .ok_or_else(|| "The source has no parent folder.".to_string())?;
    let destination = parent.join(name);
    Ok(RenamePaths {
        source,
        destination,
    })
}

fn check_source(path: &Path) -> Result<super::transfer::EntryKind, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(super::transfer::kind_from_metadata(path, &metadata)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            Err("The source no longer exists.".into())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn check_destination(path: &Path) -> Result<(), String> {
    // symlink_metadata detects an occupied name even if its link target is gone.
    match fs::symlink_metadata(path) {
        Ok(_) => Err(OCCUPIED_NAME.into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// Keep errors aligned with the preview rows. Validate against the filesystem
// because the current pane may hide other items in a filtered directory.
pub fn validate_batch_rename(requests: Vec<BatchRenameRequest>) -> Vec<Option<String>> {
    let mut errors = vec![None; requests.len()];
    let mut sources = HashMap::with_capacity(requests.len());
    let mut destinations = HashMap::with_capacity(requests.len());

    for (index, request) in requests.iter().enumerate() {
        let paths = match rename_paths(&request.path, &request.next_name) {
            Ok(paths) if paths.source.is_absolute() => paths,
            Ok(_) => {
                errors[index] = Some("Select an item with an absolute path.".into());
                continue;
            }
            Err(error) => {
                errors[index] = Some(error);
                continue;
            }
        };

        let source_key = normalize_path_key(&paths.source);
        let destination_key = normalize_path_key(&paths.destination);
        errors[index] = check_source(&paths.source)
            .and_then(|_| {
                if paths.source == paths.destination {
                    Ok(())
                } else if source_key == destination_key {
                    Err("Batch rename cannot change only the letter case.".into())
                } else {
                    check_destination(&paths.destination)
                }
            })
            .err();

        mark_duplicate(
            &mut sources,
            &mut errors,
            source_key,
            index,
            "This item appears more than once.",
        );
        mark_duplicate(
            &mut destinations,
            &mut errors,
            destination_key,
            index,
            "More than one item would receive this name.",
        );
    }
    errors
}

fn mark_duplicate(
    seen: &mut HashMap<String, usize>,
    errors: &mut [Option<String>],
    key: String,
    index: usize,
    message: &str,
) {
    if let Some(previous) = seen.insert(key, index) {
        errors[previous].get_or_insert_with(|| message.into());
        errors[index].get_or_insert_with(|| message.into());
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamedEntry {
    #[serde(skip)]
    pub(crate) kind: super::transfer::EntryKind,
    pub path: String,
    pub identity: Option<EntryIdentity>,
}

pub fn rename_entry(
    path: String,
    new_name: String,
    expected: Option<EntryIdentity>,
) -> Result<RenamedEntry, String> {
    let paths = rename_paths(&path, &new_name)?;
    let kind = check_source(&paths.source)?;

    let source = paths.source.to_string_lossy();
    let destination = paths.destination.to_string_lossy();
    if source == destination {
        return Ok(RenamedEntry {
            kind,
            path: source.into_owned(),
            identity: None,
        });
    }

    // Windows resolves both spellings of a case-only rename to the same item.
    // Let the no-replace operation distinguish that case from an occupied name.
    let identity = if let Some(expected) = expected {
        staging::retry_sharing(|| rename_verified(&paths.source, &paths.destination, &expected))
            .map_err(rename_failure)?;
        None
    } else {
        let original = ObservedEntry::capture(&paths.source);
        let result = staging::rename_new(&paths.source, &paths.destination);
        #[cfg(windows)]
        let result = match &original {
            Some(original) => staging::retry_after_sharing(result, || {
                rename_verified(&paths.source, &paths.destination, original.identity())
            }),
            None => result,
        };
        result.map_err(rename_failure)?;
        original.and_then(|entry| entry.published(&paths.destination))
    };
    Ok(RenamedEntry {
        kind,
        path: destination.into_owned(),
        identity,
    })
}

fn rename_failure(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::AlreadyExists {
        return OCCUPIED_NAME.into();
    }
    #[cfg(windows)]
    if staging::is_sharing_violation(&error) {
        return "Windows is blocking the rename because the item is still in use. Try again once it is available.".into();
    }
    error.to_string()
}

#[cfg(test)]
#[path = "rename_tests.rs"]
mod tests;
