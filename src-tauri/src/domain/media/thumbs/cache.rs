// Cache helpers: resolve the cache location, keep an in-memory index in sync,
// and trim old files when the cache grows beyond the configured budget.
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

use super::{
    CacheTrimState, ThumbnailState, TRIM_SCAN_INTERVAL_SECS, TRIM_SCAN_THRESHOLD_PERCENT,
    TRIM_UNKNOWN_SCAN_GROWTH_BYTES,
};

struct CacheEntry {
    path: PathBuf,
    modified: SystemTime,
    size: u64,
}

pub(super) fn resolve_cache_dir(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("thumbs")
}

pub(super) fn load_cache_index(cache_dir: &Path) -> HashSet<String> {
    let mut index = HashSet::new();
    let mut stack = vec![cache_dir.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let read_dir = match fs::read_dir(&dir) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for item in read_dir {
            let entry = match item {
                Ok(value) => value,
                Err(_) => continue,
            };
            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                stack.push(path);
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            index.insert(file_name.to_string());
        }
    }

    index
}

pub(super) fn has_cache_entry(state: &ThumbnailState, id: &str) -> bool {
    state
        .cache_index
        .lock()
        .expect("thumb cache index lock")
        .contains(id)
}

pub(super) fn mark_cache_entry(state: &ThumbnailState, id: &str) {
    state
        .cache_index
        .lock()
        .expect("thumb cache index lock")
        .insert(id.to_string());
}

pub(super) fn maybe_trim_cache(state: &ThumbnailState, limit_mb: u32, added_bytes: u64) {
    if limit_mb == 0 {
        return;
    }
    let limit_bytes = limit_mb as u64 * 1024 * 1024;
    if limit_bytes == 0 {
        return;
    }

    let now = SystemTime::now();
    let mut should_scan = false;
    let mut force_scan = false;
    let pending_for_scan: u64;
    {
        let mut trim_state = state.trim_state.lock().expect("thumb trim lock");

        if added_bytes > 0 {
            trim_state.pending_growth_bytes =
                trim_state.pending_growth_bytes.saturating_add(added_bytes);
        }

        let pending_growth = trim_state.pending_growth_bytes;
        if pending_growth == 0 {
            return;
        }
        pending_for_scan = pending_growth;

        match trim_state.approx_total_bytes {
            Some(approx_total) => {
                let projected_total = approx_total.saturating_add(pending_growth);
                let threshold = limit_bytes.saturating_mul(TRIM_SCAN_THRESHOLD_PERCENT) / 100;
                if projected_total >= threshold {
                    should_scan = true;
                    force_scan = projected_total >= limit_bytes;
                }
            }
            None => {
                let unknown_threshold = TRIM_UNKNOWN_SCAN_GROWTH_BYTES.min(limit_bytes);
                if pending_growth >= unknown_threshold {
                    should_scan = true;
                }
            }
        }

        if !should_scan {
            return;
        }

        if !force_scan {
            if let Some(previous) = trim_state.last_trim {
                if now.duration_since(previous).unwrap_or_default()
                    < Duration::from_secs(TRIM_SCAN_INTERVAL_SECS)
                {
                    return;
                }
            }
        }

        trim_state.last_trim = Some(now);
    }

    let (mut entries, mut total) = collect_cache_entries(&state.cache_dir);
    if total <= limit_bytes {
        let mut trim_state = state.trim_state.lock().expect("thumb trim lock");
        trim_state.approx_total_bytes = Some(total);
        trim_state.pending_growth_bytes =
            trim_state.pending_growth_bytes.saturating_sub(pending_for_scan);
        return;
    }

    let mut removed_ids = Vec::new();
    entries.sort_by_key(|entry| entry.modified);
    for entry in entries {
        if total <= limit_bytes {
            break;
        }
        if fs::remove_file(&entry.path).is_ok() {
            total = total.saturating_sub(entry.size);
            if let Some(file_name) = entry.path.file_name().and_then(|value| value.to_str()) {
                removed_ids.push(file_name.to_string());
            }
        }
    }

    if !removed_ids.is_empty() {
        let mut cache_index = state.cache_index.lock().expect("thumb cache index lock");
        for id in removed_ids {
            cache_index.remove(&id);
        }
    }

    let mut trim_state = state.trim_state.lock().expect("thumb trim lock");
    trim_state.approx_total_bytes = Some(total);
    trim_state.pending_growth_bytes = trim_state.pending_growth_bytes.saturating_sub(pending_for_scan);
}

pub(super) fn get_cache_dir(app_handle: &AppHandle) -> PathBuf {
    resolve_cache_dir(app_handle)
}

pub(super) fn clear_cache(state: &ThumbnailState) -> Result<(), String> {
    if state.cache_dir.exists() {
        fs::remove_dir_all(&state.cache_dir).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&state.cache_dir).map_err(|err| err.to_string())?;

    state
        .cache_index
        .lock()
        .expect("thumb cache index lock")
        .clear();
    reset_trim_state(&state.trim_state);
    Ok(())
}

pub(super) fn get_cache_size(app_handle: &AppHandle) -> Result<u64, String> {
    let cache_dir = resolve_cache_dir(app_handle);
    if !cache_dir.exists() {
        return Ok(0);
    }
    let (_, total) = collect_cache_entries(&cache_dir);
    Ok(total)
}

fn reset_trim_state(trim_state: &std::sync::Mutex<CacheTrimState>) {
    let mut trim_state = trim_state.lock().expect("thumb trim lock");
    trim_state.last_trim = None;
    trim_state.approx_total_bytes = Some(0);
    trim_state.pending_growth_bytes = 0;
}

fn collect_cache_entries(cache_dir: &Path) -> (Vec<CacheEntry>, u64) {
    let mut entries = Vec::new();
    let mut total: u64 = 0;
    let mut stack = vec![cache_dir.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let read_dir = match fs::read_dir(&dir) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for item in read_dir {
            let entry = match item {
                Ok(value) => value,
                Err(_) => continue,
            };
            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                stack.push(path);
                continue;
            }
            let size = metadata.len();
            total = total.saturating_add(size);
            let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            entries.push(CacheEntry {
                path,
                modified,
                size,
            });
        }
    }

    (entries, total)
}
