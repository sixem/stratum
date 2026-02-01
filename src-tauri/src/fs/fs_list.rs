// Read-only filesystem queries for directory listings, metadata, and drive info.
use super::{
    DriveInfo, EntryMeta, FileEntry, ListDirOptions, ListDirResult, ListDirWithParentResult, Place,
    SortDir, SortKey, SortState,
};
use std::cmp::Ordering;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetLogicalDrives, GetVolumeInformationW,
};
#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;

const LIST_DIR_CANCEL_CHECK_INTERVAL: usize = 32;
const LIST_DIR_CANCEL_MESSAGE: &str = "Directory listing canceled";

// Track the newest list_dir generation so older scans can stop early.
static LIST_DIR_LATEST_GENERATION: AtomicU64 = AtomicU64::new(0);

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

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn push_place(places: &mut Vec<Place>, name: &str, path: PathBuf) {
    if path.exists() {
        places.push(Place {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
        });
    }
}

fn default_sort_state() -> SortState {
    SortState {
        key: SortKey::Name,
        dir: SortDir::Asc,
    }
}

fn normalize_search(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_lowercase()
}

fn compare_numbers(a: Option<u64>, b: Option<u64>) -> Ordering {
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => left.cmp(&right),
    }
}

#[derive(Clone, Copy)]
enum Segment<'a> {
    Digits { value: Option<u64>, len: usize, raw: &'a str },
    Text(&'a str),
}

impl<'a> Segment<'a> {
    fn as_str(&self) -> &str {
        match self {
            Segment::Digits { raw, .. } => raw,
            Segment::Text(value) => value,
        }
    }
}

fn next_segment<'a>(value: &'a str, start: usize) -> (Segment<'a>, usize) {
    let mut iter = value[start..].char_indices();
    let (_first_offset, first_char) = iter
        .next()
        .map(|(offset, ch)| (offset, ch))
        .unwrap_or((0, '\0'));
    let is_digit = first_char.is_ascii_digit();
    let mut end = start + first_char.len_utf8();
    for (offset, ch) in iter {
        if ch.is_ascii_digit() != is_digit {
            break;
        }
        end = start + offset + ch.len_utf8();
    }
    let segment = &value[start..end];
    if is_digit {
        let parsed = segment.parse::<u64>().ok();
        (
            Segment::Digits {
                value: parsed,
                len: segment.len(),
                raw: segment,
            },
            end,
        )
    } else {
        (Segment::Text(segment), end)
    }
}

// Approximate Intl.Collator numeric + case-insensitive ordering from the UI.
fn natural_compare(left: &str, right: &str) -> Ordering {
    let mut left_index = 0;
    let mut right_index = 0;
    let left_len = left.len();
    let right_len = right.len();

    while left_index < left_len && right_index < right_len {
        let (left_segment, next_left) = next_segment(left, left_index);
        let (right_segment, next_right) = next_segment(right, right_index);
        left_index = next_left;
        right_index = next_right;

        let ordering = match (left_segment, right_segment) {
            (
                Segment::Digits {
                    value: left_value,
                    len: left_len,
                    raw: left_raw,
                },
                Segment::Digits {
                    value: right_value,
                    len: right_len,
                    raw: right_raw,
                },
            ) => match (left_value, right_value) {
                (Some(l), Some(r)) if l != r => l.cmp(&r),
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                _ => {
                    if left_len != right_len {
                        left_len.cmp(&right_len)
                    } else {
                        left_raw.cmp(right_raw)
                    }
                }
            },
            (Segment::Text(left_text), Segment::Text(right_text)) => left_text.cmp(right_text),
            (left_segment, right_segment) => left_segment.as_str().cmp(right_segment.as_str()),
        };

        if ordering != Ordering::Equal {
            return ordering;
        }
    }

    left_len.cmp(&right_len)
}

fn compare_names(left: &str, right: &str) -> Ordering {
    let left_lower = left.to_lowercase();
    let right_lower = right.to_lowercase();
    natural_compare(&left_lower, &right_lower)
}

fn apply_sort_dir(ordering: Ordering, dir: SortDir) -> Ordering {
    match dir {
        SortDir::Asc => ordering,
        SortDir::Desc => ordering.reverse(),
    }
}

// Keep folders first, then apply the requested sort with name fallbacks.
fn compare_entries(left: &FileEntry, right: &FileEntry, sort: &SortState) -> Ordering {
    if left.is_dir != right.is_dir {
        return if left.is_dir {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }

    match sort.key {
        SortKey::Name => apply_sort_dir(compare_names(&left.name, &right.name), sort.dir),
        SortKey::Size => {
            let size_order = compare_numbers(left.size, right.size);
            if size_order != Ordering::Equal {
                return apply_sort_dir(size_order, sort.dir);
            }
            compare_names(&left.name, &right.name)
        }
        SortKey::Modified => {
            let modified_order = compare_numbers(left.modified, right.modified);
            if modified_order != Ordering::Equal {
                return apply_sort_dir(modified_order, sort.dir);
            }
            compare_names(&left.name, &right.name)
        }
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
    use std::iter::once;

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

#[cfg(target_os = "windows")]
fn drive_label(path: &str) -> Option<String> {
    use std::iter::once;

    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).collect();
    let mut name_buffer = [0u16; 256];
    let ok = unsafe {
        GetVolumeInformationW(
            wide.as_ptr(),
            name_buffer.as_mut_ptr(),
            name_buffer.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };
    if ok == 0 {
        return None;
    }
    let len = name_buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(name_buffer.len());
    let label = String::from_utf16_lossy(&name_buffer[..len]);
    let trimmed = label.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn drive_label(_path: &str) -> Option<String> {
    None
}

pub fn list_drive_info() -> Vec<DriveInfo> {
    list_drives()
        .into_iter()
        .map(|path| {
            let (free, total) = drive_space(&path);
            let label = drive_label(&path);
            DriveInfo {
                path,
                free,
                total,
                label,
            }
        })
        .collect()
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

    let entries = fs::read_dir(&target).map_err(|err| err.to_string())?;
    let mut items = Vec::new();
    let mut total_count = 0;
    let has_search = !search.is_empty();

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
        let name = entry.file_name().to_string_lossy().to_string();
        if has_search && !name.to_lowercase().contains(&search) {
            continue;
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
                    meta.modified().ok().and_then(super::to_epoch_ms),
                ),
                None => (None, None),
            }
        } else {
            (None, None)
        };

        items.push(FileEntry {
            name,
            path,
            is_dir,
            size,
            modified,
        });
    }
    if is_list_dir_generation_stale(generation) {
        return Err(LIST_DIR_CANCEL_MESSAGE.into());
    }
    if items.len() > 1 {
        items.sort_by(|left, right| compare_entries(left, right, &sort));
    }

    Ok(ListDirResult {
        entries: items,
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
                let modified = metadata.modified().ok().and_then(super::to_epoch_ms);
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
