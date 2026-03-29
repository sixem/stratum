// Directory listing and lightweight metadata helpers live here.
// The listing scan precomputes a normalized name once per entry for search and sorting.
use super::super::{
    EntryMeta, FileEntry, ListDirOptions, ListDirResult, ListDirWithParentResult, SortKey,
};
use super::places::home_dir;
use super::sort::{
    compare_entry_fields, default_sort_state, normalize_name, normalize_search, EntrySortFields,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

const LIST_DIR_CANCEL_CHECK_INTERVAL: usize = 32;
const LIST_DIR_CANCEL_MESSAGE: &str = "Directory listing canceled";

// Track the newest list_dir generation so older scans can stop early.
static LIST_DIR_LATEST_GENERATION: AtomicU64 = AtomicU64::new(0);

struct ScannedEntry {
    file_entry: FileEntry,
    normalized_name: String,
}

fn start_list_dir_generation(generation: Option<u64>) -> Result<Option<u64>, String> {
    let generation = match generation {
        Some(value) => value,
        None => return Ok(None),
    };

    // fetch_max keeps the newest generation when requests overlap.
    let previous = LIST_DIR_LATEST_GENERATION.fetch_max(generation, AtomicOrdering::Relaxed);
    if previous > generation {
        return Err(LIST_DIR_CANCEL_MESSAGE.into());
    }
    Ok(Some(generation))
}

fn is_list_dir_generation_stale(generation: Option<u64>) -> bool {
    match generation {
        Some(value) => LIST_DIR_LATEST_GENERATION.load(AtomicOrdering::Relaxed) != value,
        None => false,
    }
}

fn should_cancel_list_dir(generation: Option<u64>, scanned: usize) -> bool {
    if scanned % LIST_DIR_CANCEL_CHECK_INTERVAL != 0 {
        return false;
    }
    is_list_dir_generation_stale(generation)
}

fn scan_dir_entry(
    entry: fs::DirEntry,
    include_meta: bool,
    search: &str,
    has_search: bool,
) -> Option<ScannedEntry> {
    let name = entry.file_name().to_string_lossy().to_string();
    let normalized_name = normalize_name(&name);
    if has_search && !normalized_name.contains(search) {
        return None;
    }

    let path = entry.path().to_string_lossy().to_string();
    // Pull metadata once when needed so we can derive is_dir + size/modified without
    // a second syscall.
    let metadata = if include_meta {
        entry.metadata().ok()
    } else {
        None
    };
    let is_dir = match metadata.as_ref() {
        Some(meta) => meta.is_dir(),
        None => entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false),
    };
    let (size, modified) = if include_meta && !is_dir {
        match metadata.as_ref() {
            Some(meta) => (
                Some(meta.len()),
                meta.modified().ok().and_then(super::super::to_epoch_ms),
            ),
            None => (None, None),
        }
    } else {
        (None, None)
    };

    Some(ScannedEntry {
        file_entry: FileEntry {
            name,
            path,
            is_dir,
            size,
            modified,
        },
        normalized_name,
    })
}

pub fn list_dir(path: String, options: Option<ListDirOptions>) -> Result<ListDirResult, String> {
    let trimmed = path.trim();
    let target = if trimmed.is_empty() {
        home_dir().ok_or_else(|| "Unable to resolve home directory".to_string())?
    } else {
        PathBuf::from(trimmed)
    };
    let options = options.unwrap_or(ListDirOptions {
        sort: None,
        search: None,
        fast: None,
        generation: None,
    });
    let generation = start_list_dir_generation(options.generation)?;
    let sort = options.sort.unwrap_or_else(default_sort_state);
    let search = normalize_search(options.search);
    let fast = options.fast.unwrap_or(false);
    // For size/modified sorts we need file metadata, but keep folders name-sorted.
    let include_meta = !fast && !matches!(sort.key, SortKey::Name);
    let has_search = !search.is_empty();

    let entries = fs::read_dir(&target).map_err(|err| err.to_string())?;
    let mut items = Vec::new();
    let mut total_count = 0;

    let mut scanned = 0;
    for entry in entries {
        if should_cancel_list_dir(generation, scanned) {
            return Err(LIST_DIR_CANCEL_MESSAGE.into());
        }
        scanned += 1;
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        total_count += 1;

        if let Some(scanned_entry) = scan_dir_entry(entry, include_meta, &search, has_search) {
            items.push(scanned_entry);
        }
    }
    if is_list_dir_generation_stale(generation) {
        return Err(LIST_DIR_CANCEL_MESSAGE.into());
    }
    if items.len() > 1 {
        items.sort_by(|left, right| {
            compare_entry_fields(
                EntrySortFields {
                    is_dir: left.file_entry.is_dir,
                    normalized_name: &left.normalized_name,
                    size: left.file_entry.size,
                    modified: left.file_entry.modified,
                },
                EntrySortFields {
                    is_dir: right.file_entry.is_dir,
                    normalized_name: &right.normalized_name,
                    size: right.file_entry.size,
                    modified: right.file_entry.modified,
                },
                &sort,
            )
        });
    }

    Ok(ListDirResult {
        entries: items.into_iter().map(|item| item.file_entry).collect(),
        total_count,
    })
}

pub fn list_dir_with_parent(
    path: String,
    options: Option<ListDirOptions>,
) -> Result<ListDirWithParentResult, String> {
    let path_copy = path.clone();
    let result = list_dir(path, options)?;
    let parent_path = parent_dir(path_copy);
    Ok(ListDirWithParentResult {
        entries: result.entries,
        total_count: result.total_count,
        parent_path,
    })
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
                let modified = metadata.modified().ok().and_then(super::super::to_epoch_ms);
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
