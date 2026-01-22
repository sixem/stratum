use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetLogicalDrives};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub name: String,
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryMeta {
    pub path: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyReport {
    pub copied: usize,
    pub skipped: usize,
    pub failures: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    pub deleted: usize,
    pub skipped: usize,
    pub failures: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub path: String,
    pub free: Option<u64>,
    pub total: Option<u64>,
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn to_epoch_ms(time: SystemTime) -> Option<u64> {
    // Use epoch milliseconds so the UI can format locally.
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn push_place(places: &mut Vec<Place>, name: &str, path: PathBuf) {
    if path.exists() {
        places.push(Place {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
        });
    }
}

pub fn get_home() -> Option<String> {
    home_dir().map(|path| path.to_string_lossy().to_string())
}

pub fn get_places() -> Vec<Place> {
    let mut places = Vec::new();
    if let Some(home) = home_dir() {
        push_place(&mut places, "Home", home.clone());
        push_place(&mut places, "Desktop", home.join("Desktop"));
        push_place(&mut places, "Documents", home.join("Documents"));
        push_place(&mut places, "Downloads", home.join("Downloads"));
        push_place(&mut places, "Pictures", home.join("Pictures"));
    }
    places
}

pub fn list_drives() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let mask = unsafe { GetLogicalDrives() };
        if mask == 0 {
            return Vec::new();
        }
        let mut drives = Vec::new();
        for index in 0..26 {
            if (mask >> index) & 1 == 1 {
                let letter = (b'A' + index as u8) as char;
                drives.push(format!("{}:\\", letter));
            }
        }
        drives
    }

    #[cfg(not(target_os = "windows"))]
    {
        vec!["/".to_string()]
    }
}

#[cfg(target_os = "windows")]
fn drive_space(path: &str) -> (Option<u64>, Option<u64>) {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).collect();
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            std::ptr::null_mut(),
            &mut total as *mut u64,
            &mut free as *mut u64,
        )
    };
    if ok == 0 {
        return (None, None);
    }
    (Some(free), Some(total))
}

#[cfg(not(target_os = "windows"))]
fn drive_space(_path: &str) -> (Option<u64>, Option<u64>) {
    (None, None)
}

pub fn list_drive_info() -> Vec<DriveInfo> {
    list_drives()
        .into_iter()
        .map(|path| {
            let (free, total) = drive_space(&path);
            DriveInfo { path, free, total }
        })
        .collect()
}

pub fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let trimmed = path.trim();
    let target = if trimmed.is_empty() {
        home_dir().ok_or_else(|| "Unable to resolve home directory".to_string())?
    } else {
        PathBuf::from(trimmed)
    };

    let entries = fs::read_dir(&target).map_err(|err| err.to_string())?;
    let mut items = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();

        items.push(FileEntry {
            name,
            path,
            is_dir,
            size: None,
            modified: None,
        });
    }

    items.sort_by_cached_key(|entry| (!entry.is_dir, entry.name.to_lowercase()));

    Ok(items)
}

pub fn stat_entries(paths: Vec<String>) -> Vec<EntryMeta> {
    let mut results = Vec::with_capacity(paths.len());

    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let (size, modified) = match fs::metadata(trimmed) {
            Ok(metadata) => {
                let is_dir = metadata.is_dir();
                let size = if is_dir { None } else { Some(metadata.len()) };
                let modified = metadata.modified().ok().and_then(to_epoch_ms);
                (size, modified)
            }
            Err(_) => (None, None),
        };

        results.push(EntryMeta {
            path: trimmed.to_string(),
            size,
            modified,
        });
    }

    results
}

pub fn parent_dir(path: String) -> Option<String> {
    let target = Path::new(path.trim());
    target
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
}

fn unique_destination(path: &Path) -> PathBuf {
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

fn copy_dir(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|err| err.to_string())?;
    for entry in fs::read_dir(src).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_dir() {
            copy_dir(&src_path, &dest_path)?;
        } else {
            fs::copy(&src_path, &dest_path).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn copy_path(src: &Path, dest: &Path) -> Result<(), String> {
    let metadata = fs::metadata(src).map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        return copy_dir(src, dest);
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::copy(src, dest).map_err(|err| err.to_string())?;
    Ok(())
}

pub fn copy_entries(paths: Vec<String>, destination: String) -> Result<CopyReport, String> {
    let target = destination.trim();
    if target.is_empty() {
        return Err("Empty destination".to_string());
    }
    let target_path = PathBuf::from(target);
    if !target_path.exists() {
        return Err("Destination does not exist".to_string());
    }
    if !target_path.is_dir() {
        return Err("Destination is not a folder".to_string());
    }

    let mut report = CopyReport {
        copied: 0,
        skipped: 0,
        failures: Vec::new(),
    };

    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            report.skipped += 1;
            continue;
        }
        let src = PathBuf::from(trimmed);
        if !src.exists() {
            report.skipped += 1;
            continue;
        }
        if src.is_dir() && target_path.starts_with(&src) {
            report
                .failures
                .push(format!("{}: destination is inside source", trimmed));
            continue;
        }
        let name = match src.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => {
                report.skipped += 1;
                continue;
            }
        };
        let dest_path = unique_destination(&target_path.join(name));
        match copy_path(&src, &dest_path) {
            Ok(_) => report.copied += 1,
            Err(err) => report.failures.push(format!("{}: {}", trimmed, err)),
        }
    }

    Ok(report)
}

pub fn delete_entries(paths: Vec<String>) -> Result<DeleteReport, String> {
    let mut report = DeleteReport {
        deleted: 0,
        skipped: 0,
        failures: Vec::new(),
    };

    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            report.skipped += 1;
            continue;
        }
        let target = PathBuf::from(trimmed);
        if !target.exists() {
            report.skipped += 1;
            continue;
        }
        let result = if target.is_dir() {
            fs::remove_dir_all(&target)
        } else {
            fs::remove_file(&target)
        };
        match result {
            Ok(_) => report.deleted += 1,
            Err(err) => report
                .failures
                .push(format!("{}: {}", trimmed, err.to_string())),
        }
    }

    Ok(report)
}
