// Directory listing and lightweight metadata helpers live here.
// The listing scan precomputes a normalized name once per entry for search and sorting.
use super::super::{
    EntryMeta, FileEntry, ListDirOptions, ListDirResult, ListDirWithParentResult, SortKey,
};
use super::places::home_dir;
use super::sort::{compare_entry_fields, default_sort_state, normalize_name, EntrySortFields};
use crate::domain::file_search::{FileSearch, FileSearchFilters};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

const LIST_DIR_CANCEL_CHECK_INTERVAL: usize = 32;
const LIST_DIR_CANCEL_MESSAGE: &str = "Directory listing canceled";

// Track the newest list_dir generation so older scans can stop early.
static LIST_DIR_LATEST_GENERATION: [AtomicU64; 2] = [AtomicU64::new(0), AtomicU64::new(0)];

struct ScannedEntry {
    file_entry: FileEntry,
    normalized_name: String,
}

type ScanGeneration = (&'static AtomicU64, u64);

fn start_list_dir_generation(
    pane: super::super::FilePane,
    generation: Option<u64>,
) -> Result<Option<ScanGeneration>, String> {
    let generation = match generation {
        Some(value) => value,
        None => return Ok(None),
    };

    // fetch_max keeps the newest generation when requests overlap.
    let latest = &LIST_DIR_LATEST_GENERATION[pane as usize];
    let previous = latest.fetch_max(generation, AtomicOrdering::Relaxed);
    if previous > generation {
        return Err(LIST_DIR_CANCEL_MESSAGE.into());
    }
    Ok(Some((latest, generation)))
}

fn is_list_dir_generation_stale(generation: Option<ScanGeneration>) -> bool {
    match generation {
        Some((latest, value)) => latest.load(AtomicOrdering::Relaxed) != value,
        None => false,
    }
}

fn should_cancel_list_dir(generation: Option<ScanGeneration>, scanned: usize) -> bool {
    if scanned % LIST_DIR_CANCEL_CHECK_INTERVAL != 0 {
        return false;
    }
    is_list_dir_generation_stale(generation)
}

fn scan_dir_entry(
    entry: fs::DirEntry,
    include_meta: bool,
    name_query: &str,
    filters: &FileSearchFilters,
) -> Option<ScannedEntry> {
    let name = entry.file_name().to_string_lossy().to_string();
    let normalized_name = normalize_name(&name);
    if !normalized_name.contains(name_query) {
        return None;
    }

    // Check kind before metadata so a size search never has to stat folders
    // or names and extensions that will be excluded anyway.
    let file_type = entry.file_type().ok()?;
    #[cfg(windows)]
    let is_dir = {
        use std::os::windows::fs::FileTypeExt;
        file_type.is_dir() || file_type.is_symlink_dir()
    };
    #[cfg(not(windows))]
    let is_dir = file_type.is_dir();
    if filters.has_filters() {
        if (is_dir && filters.has_size()) || !filters.matches_type(&normalized_name, is_dir) {
            return None;
        }
    }

    // Pull metadata once when needed so we can derive is_dir + size/modified without
    // a second syscall.
    let metadata = if include_meta || filters.has_size() {
        entry.metadata().ok()
    } else {
        None
    };
    let (size, modified) = if !is_dir {
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
    if !filters.matches_size(size) {
        return None;
    }

    Some(ScannedEntry {
        file_entry: FileEntry {
            name,
            path: entry.path().to_string_lossy().into_owned(),
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
        include_meta: None,
        generation: None,
        pane: Default::default(),
    });
    let generation = start_list_dir_generation(options.pane, options.generation)?;
    let sort = options.sort.unwrap_or_else(default_sort_state);
    let search = FileSearch::parse(options.search.as_deref().unwrap_or_default());
    let name_query = normalize_name(&search.name_query);
    let fast = options.fast.unwrap_or(false);
    // For size/modified sorts we need file metadata, but keep folders name-sorted.
    let include_meta =
        options.include_meta.unwrap_or(false) || (!fast && !matches!(sort.key, SortKey::Name));

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

        if let Some(scanned_entry) =
            scan_dir_entry(entry, include_meta, &name_query, &search.filters)
        {
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
                    name: &left.file_entry.name,
                    normalized_name: &left.normalized_name,
                    size: left.file_entry.size,
                    modified: left.file_entry.modified,
                },
                EntrySortFields {
                    is_dir: right.file_entry.is_dir,
                    name: &right.file_entry.name,
                    normalized_name: &right.normalized_name,
                    size: right.file_entry.size,
                    modified: right.file_entry.modified,
                },
                &sort,
            )
        });
    }

    // Navigation can change while a large result is being sorted.
    if is_list_dir_generation_stale(generation) {
        return Err(LIST_DIR_CANCEL_MESSAGE.into());
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::filesystem::FilePane;

    struct TestFolder(PathBuf);
    impl Drop for TestFolder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn test_folder() -> TestFolder {
        let root = TestFolder(std::env::temp_dir().join(format!(
            "stratum-listing-{}-{}",
            std::process::id(),
            getrandom::u64().unwrap()
        )));
        fs::create_dir(&root.0).unwrap();
        root
    }

    #[cfg(windows)]
    #[test]
    fn lists_a_junction_as_a_navigable_folder() {
        let root = test_folder();
        fs::create_dir(root.0.join("target")).unwrap();
        fs::write(root.0.join("target").join("inside.txt"), b"inside").unwrap();
        let result = std::process::Command::new("cmd.exe")
            .current_dir(&root.0)
            .args(["/d", "/c", "mklink", "/j", "alias", "target"])
            .output()
            .unwrap();
        assert!(result.status.success(), "{result:?}");
        let entries = list_dir(root.0.to_str().unwrap().into(), None).unwrap().entries;
        let alias = entries.iter().find(|entry| entry.name == "alias").unwrap();
        assert!(alias.is_dir);
        assert_eq!(
            list_dir(alias.path.clone(), None).unwrap().entries[0].name,
            "inside.txt"
        );
    }

    #[test]
    fn filters_by_size_and_type_even_in_fast_name_order() {
        let root = test_folder();
        fs::write(root.0.join("Concert small.mp4"), [0; 12]).unwrap();
        fs::write(root.0.join("Concert live.MP4"), [0; 17]).unwrap();
        fs::write(root.0.join("Concert notes.txt"), [0; 24]).unwrap();
        fs::create_dir(root.0.join("Concert folder.mp4")).unwrap();

        for pane in [FilePane::Main, FilePane::Bottom] {
            let list = |search: &str| {
                list_dir(
                    root.0.to_str().unwrap().into(),
                    Some(ListDirOptions {
                        sort: None,
                        search: Some(search.to_string()),
                        fast: Some(true),
                        include_meta: None,
                        generation: None,
                        pane,
                    }),
                )
                .unwrap()
            };
            let result = list(">12B type:video concert");
            assert_eq!(result.total_count, 4);
            assert_eq!(result.entries.len(), 1);
            assert_eq!(result.entries[0].name, "Concert live.MP4");
            assert_eq!(result.entries[0].size, Some(17));

            assert_eq!(list("ext:mp4").entries.len(), 2);
            assert!(list("type:folder").entries[0].is_dir);
            assert!(list("type:folder >=0B").entries.is_empty());
            assert_eq!(list("concert").entries.len(), 4);
        }
    }
}
