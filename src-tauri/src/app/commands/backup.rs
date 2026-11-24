// Backup files are read and written only at paths chosen in a native dialog.
#[cfg(test)]
mod tests;

use crate::domain::filesystem::staging::StageDirectory;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

// Leave room for a full profile and its live session while bounding arbitrary input files.
const MAX_BACKUP_BYTES: u64 = 16 * 1024 * 1024;

fn read_contents(path: &Path) -> Result<String, String> {
    let mut buffer = String::new();
    let file = File::open(path).map_err(|err| format!("Couldn't open the backup: {err}"))?;
    if !file.metadata().map_err(|err| err.to_string())?.is_file() {
        return Err("Choose a Stratum backup file.".to_owned());
    }
    file.take(MAX_BACKUP_BYTES + 1)
        .read_to_string(&mut buffer)
        .map_err(|err| format!("Couldn't read the backup: {err}"))?;
    if buffer.len() as u64 > MAX_BACKUP_BYTES {
        return Err("The backup exceeds 16 MiB.".to_owned());
    }
    Ok(buffer)
}

fn write_contents(path: &Path, data: &str) -> io::Result<()> {
    let stage = StageDirectory::beside(path, "backup")?;
    let pending = stage.path.join("backup.json");
    // Complete a same-volume write before replacing an existing backup.
    let result = (|| {
        let mut file = File::options()
            .write(true)
            .create_new(true)
            .open(&pending)?;
        file.write_all(data.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&pending, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&pending);
    }
    result
}

#[tauri::command]
pub async fn open_stratum_backup(window: WebviewWindow) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Import Stratum backup")
            .add_filter("Stratum backup", &["json"])
            .blocking_pick_file()
            .map(|path| read_contents(&path.into_path().map_err(|err| err.to_string())?))
            .transpose()
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn save_stratum_backup(
    window: WebviewWindow,
    data: String,
    file_name: String,
) -> Result<bool, String> {
    if data.len() as u64 > MAX_BACKUP_BYTES {
        return Err("The backup exceeds 16 MiB. Export fewer workspaces at a time.".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Export Stratum backup")
            .set_file_name(file_name)
            .add_filter("Stratum backup", &["json"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        write_contents(&path.into_path().map_err(|err| err.to_string())?, &data)
            .map_err(|err| format!("Couldn't save the backup: {err}"))?;
        Ok(true)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn probe_backup_folders(paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .filter(|path| {
                let path = Path::new(path);
                is_local_absolute_path(path) && !path.is_dir()
            })
            .collect()
    })
    .await
    .map_err(|err| err.to_string())
}

// Checking an imported backup should not connect to an arbitrary UNC server.
fn is_local_absolute_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        let Some(Component::Prefix(prefix)) = path.components().next() else {
            return false;
        };
        let local = match prefix.kind() {
            Prefix::Disk(_) | Prefix::VerbatimDisk(_) => true,
            Prefix::Verbatim(volume) => volume
                .to_str()
                .is_some_and(|name| name.to_ascii_lowercase().starts_with("volume{")),
            _ => false,
        };
        local && path.is_absolute()
    }
    #[cfg(not(windows))]
    path.is_absolute()
}
