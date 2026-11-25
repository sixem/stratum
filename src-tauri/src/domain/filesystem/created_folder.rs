// Identify the folder created by a grouped move so Undo cannot touch its replacement.
use super::{entry_mutations::create_folder, file_identity::file_id};
use serde::{Deserialize, Serialize};
use std::{fs::File, io, path::Path};

#[cfg(test)]
mod tests;

#[derive(Clone, Deserialize, Serialize)]
pub struct CreatedFolder {
    pub path: String,
    identity: String,
}

fn folder_identity(directory: &File) -> io::Result<String> {
    let (volume, file) = file_id(directory)?;
    Ok(format!("{volume:016x}:{file:032x}"))
}

#[cfg(windows)]
use super::staging::pin_directory;

#[cfg(not(windows))]
fn pin_directory(path: &Path) -> io::Result<File> {
    if !std::fs::symlink_metadata(path)?.is_dir() {
        return Err(io::ErrorKind::NotADirectory.into());
    }
    File::open(path)
}

pub fn create_tracked_folder(parent: String, name: String) -> Result<CreatedFolder, String> {
    let parent = Path::new(parent.trim());
    let valid = parent.is_absolute()
        && !name.is_empty()
        && name.trim() == name
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\']);
    #[cfg(windows)]
    let valid = valid && crate::platform::windows::file_names::plain_component(&name);
    if !valid {
        return Err("Enter a valid folder name.".into());
    }

    let target = parent.join(name);
    let path = target.to_string_lossy().into_owned();
    create_folder(path.clone())?;
    let directory = pin_directory(&target).map_err(|error| error.to_string())?;
    let identity = folder_identity(&directory).map_err(|error| error.to_string())?;
    Ok(CreatedFolder { path, identity })
}

impl CreatedFolder {
    fn open_matching(&self) -> Result<Option<File>, String> {
        let directory = match pin_directory(Path::new(&self.path)) {
            Ok(directory) => directory,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound
                        | io::ErrorKind::NotADirectory
                        | io::ErrorKind::InvalidData
                ) =>
            {
                return Ok(None)
            }
            Err(error) => return Err(error.to_string()),
        };
        let identity = folder_identity(&directory).map_err(|error| error.to_string())?;
        Ok((identity == self.identity).then_some(directory))
    }

    // Keep the verified folder open for the duration of the transfer. On Windows,
    // this prevents the path from being swapped between verification and a move.
    pub(super) fn pin_for_transfer(&self) -> Result<File, String> {
        self.open_matching()?
            .ok_or_else(|| "The folder created for this move is no longer at that location.".into())
    }
}

pub fn remove_created_folder_if_empty(folder: CreatedFolder) -> Result<bool, String> {
    let Some(directory) = folder.open_matching()? else {
        return Ok(false);
    };
    #[cfg(windows)]
    let removed = super::staging::remove_empty_pinned_directory(&directory);
    #[cfg(not(windows))]
    let removed = std::fs::remove_dir(&folder.path);
    match removed {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::DirectoryNotEmpty => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}
