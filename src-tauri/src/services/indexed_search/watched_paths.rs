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
        FindClose, FindFirstFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_READ_ATTRIBUTES, FILE_SHARE_READ, WIN32_FIND_DATAW,
    },
};

use crate::{
    domain::indexed_search::IndexedEntryKind, platform::windows::file_names::plain_component,
};

use super::{
    catalog::{CatalogEntryRecord, IndexedCatalogStore},
    scan::{can_descend_into, excluded_path},
    volume_tracking::VolumeMount,
};

const MAX_WATCH_ENTRIES: usize = 512;
const MAX_WATCH_DEPTH: usize = 32;

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
        let kind = if metadata.is_dir() {
            IndexedEntryKind::Directory
        } else {
            IndexedEntryKind::File
        };
        let Some(record) = CatalogEntryRecord::from_path(logical, kind) else {
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
    let name = path.file_name().ok_or(io::ErrorKind::InvalidInput)?;
    let wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut data: WIN32_FIND_DATAW = unsafe { std::mem::zeroed() };
    let search = unsafe { FindFirstFileW(wide.as_ptr(), &mut data) };
    if search == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    unsafe { FindClose(search) };
    let found = data.cFileName.into_iter().take_while(|unit| *unit != 0);
    Ok(name.encode_wide().eq(found))
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
