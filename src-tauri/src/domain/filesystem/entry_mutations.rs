// Simple filesystem mutations used by the command layer.
// Separating these from the shared contracts keeps the top-level module easy to scan.
use std::fs;
use std::path::{Path, PathBuf};

// Ensure a directory tree exists before filesystem operations.
pub fn ensure_dir(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Empty path".to_string());
    }
    fs::create_dir_all(trimmed).map_err(|err| err.to_string())
}

fn validate_new_entry_path(target: &Path) -> Result<(), String> {
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() || name == "." || name == ".." {
        return Err("Invalid name".to_string());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot include path separators".to_string());
    }
    Ok(())
}

// Create a new folder entry at the requested path.
pub fn create_folder(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Empty path".to_string());
    }
    let target = PathBuf::from(trimmed);
    validate_new_entry_path(&target)?;
    if target.exists() {
        return Err("A file or folder with that name already exists.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "Unable to resolve parent directory".to_string())?;
    if !parent.exists() {
        return Err("Parent folder does not exist".to_string());
    }
    fs::create_dir(&target).map_err(|err| err.to_string())
}

// Create a new empty file entry at the requested path.
pub fn create_file(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Empty path".to_string());
    }
    let target = PathBuf::from(trimmed);
    validate_new_entry_path(&target)?;
    if target.exists() {
        return Err("A file or folder with that name already exists.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "Unable to resolve parent directory".to_string())?;
    if !parent.exists() {
        return Err("Parent folder does not exist".to_string());
    }
    fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&target)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

// Rename a file or folder within its current parent directory.
pub fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Empty source path".to_string());
    }
    let name = new_name.trim();
    if name.is_empty() {
        return Err("Empty destination name".to_string());
    }
    if name == "." || name == ".." {
        return Err("Invalid name".to_string());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot include path separators".to_string());
    }

    let source = PathBuf::from(trimmed);
    if !source.exists() {
        return Err("Source does not exist".to_string());
    }
    let parent = source
        .parent()
        .ok_or_else(|| "Unable to resolve parent directory".to_string())?;
    let dest = parent.join(name);
    let source_string = source.to_string_lossy().to_string();
    let dest_string = dest.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        if source_string.eq_ignore_ascii_case(&dest_string) {
            return Ok(source_string);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if source_string == dest_string {
            return Ok(source_string);
        }
    }

    if dest.exists() {
        return Err("A file or folder with that name already exists.".to_string());
    }

    fs::rename(&source, &dest).map_err(|err| err.to_string())?;
    Ok(dest_string)
}
