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
