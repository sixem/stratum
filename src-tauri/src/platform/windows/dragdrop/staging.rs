// Drop staging helpers to keep temp paths stable.
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const DROP_ROOT_DIR: &str = "stratum-drop";
static DROP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(super) fn stage_temp_hdrop_paths(paths: &[String]) -> Result<Vec<String>, String> {
    let temp_root = std::env::temp_dir();
    // Only stage paths that are already inside temp (e.g., 7-Zip drops).
    let mut needs_stage = false;
    for path in paths {
        if Path::new(path).starts_with(&temp_root) {
            needs_stage = true;
            break;
        }
    }
    if !needs_stage {
        return Ok(paths.to_vec());
    }

    let drop_dir = create_drop_dir()?;
    let mut used_names = HashSet::new();
    let mut staged = Vec::with_capacity(paths.len());

    for path in paths {
        let source = Path::new(path);
        if !source.starts_with(&temp_root) {
            staged.push(path.clone());
            continue;
        }

        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.to_string())
            .unwrap_or_else(|| format!("drop-item-{}", staged.len() + 1));
        let relative = sanitize_relative_path(&name, staged.len());
        let unique = ensure_unique_relative_path(relative, &mut used_names);
        let destination = drop_dir.join(&unique);

        if copy_path_recursive(source, &destination).is_ok() {
            staged.push(destination.to_string_lossy().to_string());
        } else {
            // Fall back to the original path if we could not stage it.
            staged.push(path.clone());
        }
    }

    Ok(staged)
}

pub(super) fn create_drop_dir() -> Result<PathBuf, String> {
    // Keep a per-drop folder so we never race the source app's temp files.
    let root = std::env::temp_dir().join(DROP_ROOT_DIR);
    fs::create_dir_all(&root).map_err(|err| err.to_string())?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    let counter = DROP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let folder = format!("drop-{now}-{counter}");
    let path = root.join(folder);
    fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    Ok(path)
}

fn copy_path_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = source.metadata().map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        fs::create_dir_all(destination).map_err(|err| err.to_string())?;
        for entry in fs::read_dir(source).map_err(|err| err.to_string())? {
            let entry = entry.map_err(|err| err.to_string())?;
            let child_source = entry.path();
            let child_destination = destination.join(entry.file_name());
            copy_path_recursive(&child_source, &child_destination)?;
        }
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::copy(source, destination)
        .map_err(|err| err.to_string())
        .map(|_| ())
}

pub(super) fn sanitize_relative_path(name: &str, index: usize) -> PathBuf {
    let trimmed = name.trim();
    let mut path = PathBuf::new();
    for component in Path::new(trimmed).components() {
        if let Component::Normal(value) = component {
            path.push(value);
        }
    }

    if path.as_os_str().is_empty() {
        PathBuf::from(format!("drop-item-{}", index + 1))
    } else {
        path
    }
}

pub(super) fn ensure_unique_relative_path(
    path: PathBuf,
    used: &mut HashSet<PathBuf>,
) -> PathBuf {
    if used.insert(path.clone()) {
        return path;
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("drop-item");
    let extension = path.extension().and_then(|value| value.to_str());

    let mut counter = 2;
    loop {
        let filename = if let Some(ext) = extension {
            format!("{stem} ({counter}).{ext}")
        } else {
            format!("{stem} ({counter})")
        };
        let candidate = if parent.as_os_str().is_empty() {
            PathBuf::from(&filename)
        } else {
            parent.join(&filename)
        };
        if used.insert(candidate.clone()) {
            return candidate;
        }
        counter += 1;
    }
}
