// Apply best-effort pane notifications without scheduling a volume-wide scan.
use std::{
    fs::{self, File, Metadata},
    io,
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt},
    path::{Path, PathBuf},
};

use windows_sys::Win32::{
    Foundation::INVALID_HANDLE_VALUE,
    Storage::FileSystem::{
        FindClose, FindFirstFileW, FILE_ATTRIBUTE_DIRECTORY, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, WIN32_FIND_DATAW,
    },
};

use crate::{
    domain::indexed_search::IndexedEntryKind, platform::windows::file_names::plain_component,
};

use super::{
    catalog::{CatalogEntryRecord, IndexedCatalogStore},
    resumable_scan::open_frontier,
    scan::{can_descend_into, excluded_path},
    volume_tracking::VolumeMount,
};

const MAX_WATCH_ENTRIES: usize = 512;
const MAX_WATCH_DEPTH: usize = 32;
const MAX_VISITED_CHILDREN: usize = 256;

pub(super) fn refresh_visited_folder(
    catalog: &IndexedCatalogStore,
    mount: &VolumeMount,
    folder: &str,
    should_cancel: &impl Fn() -> bool,
) -> Result<(bool, Option<usize>), String> {
    let logical = Path::new(folder);
    if should_cancel() || excluded_path(logical, catalog.directory()) || mount.verify().is_err() {
        return Ok((false, None));
    }
    let Some(relative) = folder.strip_prefix(&mount.drive_path) else {
        return Ok((false, None));
    };
    let Some((physical, _pinned, _)) = open_frontier(Path::new(&mount.guid), relative) else {
        return Ok((false, None));
    };
    let Ok(entries) = fs::read_dir(&physical) else {
        return Ok((false, None));
    };
    let mut records = Vec::new();
    for (index, entry) in entries.enumerate() {
        if index == MAX_VISITED_CHILDREN || should_cancel() {
            return Ok((false, None));
        }
        let Ok(entry) = entry else {
            return Ok((false, None));
        };
        let name = entry.file_name();
        if !name.to_str().is_some_and(plain_component) {
            // An incomplete or ambiguous listing cannot prove a deletion.
            return Ok((false, None));
        }
        let path = logical.join(name);
        if excluded_path(&path, catalog.directory()) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            return Ok((false, None));
        };
        let Some(record) = CatalogEntryRecord::from_metadata(&path, &metadata) else {
            return Ok((false, None));
        };
        records.push(record);
    }
    if should_cancel() {
        return Ok((false, None));
    }
    apply_visited_children(catalog, &mount.drive_path, folder, records, &|| {
        mount.verify().is_ok() && !should_cancel()
    })
}

fn apply_visited_children(
    catalog: &IndexedCatalogStore,
    drive: &str,
    folder: &str,
    records: Vec<CatalogEntryRecord>,
    can_commit: &impl Fn() -> bool,
) -> Result<(bool, Option<usize>), String> {
    let mut writer = catalog.begin_write()?;
    let Some(mut existing) = writer.bounded_indexed_children(folder, MAX_VISITED_CHILDREN)? else {
        return Ok((false, None));
    };
    let prefix = format!("{}\\", folder.trim_end_matches('\\'));
    let mut removals = Vec::new();
    let mut additions = Vec::new();
    let mut sizes = Vec::new();
    for record in records {
        let name = &record.path[prefix.len()..];
        let previous = existing.remove(name);
        if previous
            .flatten()
            .is_some_and(|child| child.kind == record.kind)
        {
            if record.kind == IndexedEntryKind::File
                && previous
                    .flatten()
                    .is_some_and(|child| child.size_bytes != record.size_bytes)
            {
                sizes.push((record.path, record.size_bytes));
            }
        } else {
            // A directory discovered without a catalog row can already have
            // indexed descendants. Keep them when inserting its missing row.
            if previous.is_some()
                && (previous.flatten().is_some() || record.kind == IndexedEntryKind::File)
            {
                removals.push(record.path.clone());
            }
            additions.push(record);
        }
    }
    removals.extend(existing.into_keys().map(|name| format!("{prefix}{name}")));
    if removals.is_empty() && additions.is_empty() && sizes.is_empty() {
        return Ok((false, None));
    }
    let Some(removed) = writer.remove_bounded_path_trees(&removals, MAX_WATCH_ENTRIES)? else {
        return Ok((false, None));
    };
    writer.insert_batch(&additions)?;
    let changed_paths = removed > 0 || !additions.is_empty();
    let mut changed = changed_paths;
    for (path, size) in sizes {
        changed |= writer.update_file_size(&path, size)?;
    }
    if !changed || !can_commit() {
        return Ok((false, None));
    }
    let entry_count = if changed_paths {
        writer.adjust_saved_entry_count(drive, removed)?
    } else {
        None
    };
    writer.finish()?;
    Ok((true, entry_count))
}

pub(super) fn refresh(
    catalog: &IndexedCatalogStore,
    mount: &VolumeMount,
    path: &str,
    should_cancel: &impl Fn() -> bool,
) -> Result<bool, String> {
    let logical = Path::new(path);
    if should_cancel() || excluded_path(logical, catalog.directory()) || mount.verify().is_err() {
        return Ok(false);
    }
    let Some(relative) = path.strip_prefix(&mount.drive_path) else {
        return Ok(false);
    };
    let mut scanner = WatchScan {
        excluded: catalog.directory(),
        should_cancel,
        records: Vec::new(),
        remaining: MAX_WATCH_ENTRIES,
    };
    if !scanner.collect(Path::new(&mount.guid), relative, logical) {
        return Ok(false);
    }
    let Some(mut writer) =
        catalog.begin_watched_write_if_changed(path, &scanner.records, MAX_WATCH_ENTRIES)?
    else {
        return Ok(false);
    };
    if !writer.remove_watched_path_trees(&[path.to_owned()], MAX_WATCH_ENTRIES)? {
        return Ok(false);
    }
    writer.insert_batch(&scanner.records)?;
    if should_cancel() || mount.verify().is_err() {
        return Ok(false);
    }
    writer.finish()?;
    Ok(true)
}

pub(super) fn refresh_file_size(
    catalog: &IndexedCatalogStore,
    mount: &VolumeMount,
    path: &str,
    should_cancel: &impl Fn() -> bool,
) -> Result<bool, String> {
    if should_cancel()
        || excluded_path(Path::new(path), catalog.directory())
        || mount.verify().is_err()
    {
        return Ok(false);
    }
    let Some(relative) = path.strip_prefix(&mount.drive_path) else {
        return Ok(false);
    };
    let (parent, name) = relative.rsplit_once('\\').unwrap_or(("", relative));
    if !plain_component(name) {
        return Ok(false);
    }
    let size = {
        let Some((directory, _pinned, _)) = open_frontier(Path::new(&mount.guid), parent) else {
            return Ok(false);
        };
        listed_file_size(&directory.join(name))
    };
    // Windows can report directory attribute changes as generic modifications.
    // Only a positively identified file qualifies, and its subtree is untouched.
    let Some(size) = size else {
        return Ok(false);
    };
    let mut writer = catalog.begin_write()?;
    if should_cancel() || mount.verify().is_err() || !writer.update_file_size(path, Some(size))? {
        return Ok(false);
    }
    writer.finish()?;
    Ok(true)
}

struct WatchScan<'a, F> {
    excluded: Option<&'a Path>,
    should_cancel: &'a F,
    records: Vec<CatalogEntryRecord>,
    remaining: usize,
}

impl<F: Fn() -> bool> WatchScan<'_, F> {
    fn collect(&mut self, volume_root: &Path, relative: &str, logical: &Path) -> bool {
        let components: Vec<_> = relative.split('\\').take(MAX_WATCH_DEPTH + 1).collect();
        if components.len() > MAX_WATCH_DEPTH
            || !components.iter().all(|part| plain_component(part))
        {
            return false;
        }
        let Some((name, parents)) = components.split_last() else {
            return false;
        };
        let mut path = PathBuf::from(volume_root);
        let mut pinned = Vec::with_capacity(parents.len());
        // Walk from the already-identified volume. Opening each ancestor
        // without write or delete sharing keeps it stable during reads.
        for component in parents {
            path.push(component);
            let Ok(handle) = pin_directory(&path) else {
                return false;
            };
            if !matches!(has_exact_name(&path), Ok(true)) {
                return false;
            }
            pinned.push(handle);
        }
        let target = path.join(name);
        match has_exact_name(&target) {
            Ok(true) => self.collect_node(&target, logical, components.len()),
            // Windows may resolve a removed name to the destination of a
            // case-only rename. Keep only the spelling listed on disk.
            Ok(false) => true,
            Err(error) => error.kind() == io::ErrorKind::NotFound,
        }
    }

    fn collect_node(&mut self, physical: &Path, logical: &Path, depth: usize) -> bool {
        if (self.should_cancel)() || self.remaining == 0 || depth > MAX_WATCH_DEPTH {
            return false;
        }
        self.remaining -= 1;
        if excluded_path(logical, self.excluded) {
            return true;
        }
        let metadata = match fs::symlink_metadata(physical) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return true,
            Err(_) => return false,
        };
        let Some(record) = CatalogEntryRecord::from_metadata(logical, &metadata) else {
            return false;
        };
        self.records.push(record);
        if !metadata.is_dir() || !can_descend_into(&metadata) {
            return true;
        }
        let Ok(_pinned) = pin_directory(physical) else {
            return false;
        };
        let Ok(entries) = fs::read_dir(physical) else {
            return false;
        };
        entries.into_iter().all(|entry| {
            let Ok(entry) = entry else {
                return false;
            };
            let name = entry.file_name();
            name.to_str().is_some_and(plain_component)
                && self.collect_node(&entry.path(), &logical.join(name), depth + 1)
        })
    }
}

pub(super) fn pin_directory(path: &Path) -> io::Result<File> {
    let handle = File::options()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let metadata: Metadata = handle.metadata()?;
    if !metadata.is_dir() || !can_descend_into(&metadata) {
        return Err(io::Error::other("The indexed-search folder is redirected."));
    }
    Ok(handle)
}

pub(super) fn has_exact_name(path: &Path) -> io::Result<bool> {
    Ok(exact_find_data(path)?.is_some())
}

pub(super) fn listed_file_size(path: &Path) -> Option<i64> {
    let data = exact_find_data(path).ok()??;
    if data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
        return None;
    }
    let size = (u64::from(data.nFileSizeHigh) << 32) | u64::from(data.nFileSizeLow);
    i64::try_from(size).ok()
}

fn exact_find_data(path: &Path) -> io::Result<Option<WIN32_FIND_DATAW>> {
    let name = path.file_name().ok_or(io::ErrorKind::InvalidInput)?;
    let wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut data: WIN32_FIND_DATAW = unsafe { std::mem::zeroed() };
    let search = unsafe { FindFirstFileW(wide.as_ptr(), &mut data) };
    if search == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    unsafe { FindClose(search) };
    let found = data.cFileName.into_iter().take_while(|unit| *unit != 0);
    Ok(name.encode_wide().eq(found).then_some(data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::Command,
        sync::atomic::{AtomicUsize, Ordering},
    };

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let root = std::env::temp_dir().join(format!(
                "stratum-watched-folders-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn scanner(remaining: usize) -> WatchScan<'static, impl Fn() -> bool> {
        WatchScan {
            excluded: None,
            should_cancel: &|| false,
            records: Vec::new(),
            remaining,
        }
    }

    #[test]
    fn visited_folder_updates_direct_children_and_keeps_unchanged_subtrees() {
        use IndexedEntryKind::{Directory, File};

        let fixture = Fixture::new();
        let catalog = IndexedCatalogStore::open(fixture.0.join("catalog.db")).unwrap();
        let drive = r"C:\";
        let folder = r"C:\inbox";
        let record =
            |path, kind, size| CatalogEntryRecord::from_path(Path::new(path), kind, size).unwrap();
        let mut writer = catalog.begin_drive_refresh(drive).unwrap();
        writer
            .insert_batch(&[
                record(folder, Directory, None),
                record(r"C:\inbox\keep", Directory, None),
                record(r"C:\inbox\keep\unchanged.txt", File, Some(36)),
                record(r"C:\inbox\removed", Directory, None),
                record(r"C:\inbox\removed\gone.txt", File, Some(21)),
                record(r"C:\inbox\resize.txt", File, Some(12)),
                record(r"C:\inbox\missing-row\retained.txt", File, Some(38)),
            ])
            .unwrap();
        writer
            .finish_drive_refresh(drive, "test", 0, "fake-volume", None, || Ok(()))
            .unwrap();

        let listing = || {
            vec![
                record(r"C:\inbox\keep", Directory, None),
                record(r"C:\inbox\resize.txt", File, Some(241)),
                record(r"C:\inbox\added.txt", File, Some(241)),
                record(r"C:\inbox\missing-row", Directory, None),
            ]
        };
        let connection = catalog.connect().unwrap();
        let row = |path: &str| {
            let mut statement = connection
                .prepare_cached("SELECT entry_id, size_bytes FROM indexed_entries WHERE path = ?1")
                .unwrap();
            statement
                .query_row([path], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?))
                })
                .ok()
        };
        let resized = row(r"C:\inbox\resize.txt").unwrap();
        let kept = row(r"C:\inbox\keep\unchanged.txt").unwrap();
        let retained = row(r"C:\inbox\missing-row\retained.txt").unwrap();
        assert_eq!(
            apply_visited_children(&catalog, drive, folder, listing(), &|| false).unwrap(),
            (false, None)
        );
        assert!(row(r"C:\inbox\removed\gone.txt").is_some());
        assert_eq!(row(r"C:\inbox\resize.txt").unwrap(), resized);

        assert_eq!(
            apply_visited_children(&catalog, drive, folder, listing(), &|| true).unwrap(),
            (true, Some(7))
        );
        assert_eq!(row(r"C:\inbox\resize.txt"), Some((resized.0, Some(241))));
        assert_eq!(row(r"C:\inbox\keep\unchanged.txt"), Some(kept));
        assert_eq!(row(r"C:\inbox\missing-row\retained.txt"), Some(retained));
        assert!(row(r"C:\inbox\missing-row").is_some());
        assert!(row(r"C:\inbox\added.txt").is_some());
        assert!(row(r"C:\inbox\removed\gone.txt").is_none());
        assert_eq!(
            apply_visited_children(&catalog, drive, folder, listing(), &|| true).unwrap(),
            (false, None)
        );
    }

    #[test]
    fn watched_path_scanning_is_bounded_and_treats_a_missing_leaf_as_removed() {
        let fixture = Fixture::new();
        let directory = fixture.0.join("incoming");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("new.txt"), "contents").unwrap();

        let mut bounded = scanner(1);
        assert!(!bounded.collect(&fixture.0, "incoming", Path::new(r"C:\incoming")));

        let mut complete = scanner(2);
        assert!(complete.collect(&fixture.0, "incoming", Path::new(r"C:\incoming")));
        assert_eq!(complete.records[1].path, r"C:\incoming\new.txt");

        let mut missing = scanner(1);
        assert!(missing.collect(&fixture.0, "old.txt", Path::new(r"C:\old.txt")));
        assert!(missing.records.is_empty());
        assert!(missing.collect(
            &fixture.0,
            r"incoming\NEW.txt",
            Path::new(r"C:\incoming\NEW.txt"),
        ));
        assert!(missing.records.is_empty());
    }

    #[test]
    fn watched_path_scanning_keeps_junctions_as_leaves() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("target")).unwrap();
        fs::write(fixture.0.join("target").join("child.txt"), "contents").unwrap();
        let result = Command::new("cmd.exe")
            .current_dir(&fixture.0)
            .args(["/d", "/c", "mklink", "/j", "redirected", "target"])
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );

        let mut top = scanner(4);
        assert!(top.collect(&fixture.0, "redirected", Path::new(r"C:\redirected")));
        assert_eq!(top.records.len(), 1);
        let mut below = scanner(4);
        assert!(!below.collect(
            &fixture.0,
            r"redirected\child.txt",
            Path::new(r"C:\redirected\child.txt"),
        ));
        assert!(below.records.is_empty());
    }
}
