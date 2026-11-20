// Keep the user-profile catalog restricted to standard-token filesystem scans.
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

use super::catalog::IndexedCatalogStore;

const CATALOG_FILENAME: &str = "catalog-v2.db";
const LEGACY_FILES: [&str; 4] = [
    "catalog.db",
    "catalog.db-wal",
    "catalog.db-shm",
    "catalog.db-journal",
];

pub(super) fn open(path: PathBuf) -> Result<IndexedCatalogStore, String> {
    let directory = path.parent().expect("catalog is in an app data directory");
    // Earlier catalogs can contain metadata collected with administrative access.
    // Start with a new catalog so none of those rows are reused.
    match catalog_directory_exists(directory) {
        Ok(true) => {
            if let Err(error) = retire_legacy_catalog(directory) {
                // Leave locked catalogs alone and retry on the next launch.
                eprintln!("[indexed-search] Could not retire the old catalog: {error}");
            }
        }
        Ok(false) => {}
        Err(error) => {
            return Err(format!(
                "Could not use the indexed-search directory: {error}"
            ))
        }
    }
    IndexedCatalogStore::open(path)
}

pub(super) fn path_for_app(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(windows)]
    match crate::platform::windows::process_token::is_process_elevated() {
        Ok(false) => {}
        Ok(true) => return Err("Indexed search is unavailable in an administrator session. Restart Stratum without elevation to use it.".into()),
        Err(error) => return Err(format!("Could not verify Stratum’s privileges before opening the index: {error}")),
    }
    app.path()
        .app_local_data_dir()
        .map(|root| root.join("indexed-search").join(CATALOG_FILENAME))
        .map_err(|error| format!("Could not locate app data for indexed search: {error}"))
}

fn catalog_directory_exists(directory: &Path) -> io::Result<bool> {
    let attribute = match fs::symlink_metadata(directory) {
        Ok(attribute) => attribute,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if attribute.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::other("The index directory is redirected."));
        }
    }
    if !attribute.is_dir() {
        return Err(io::Error::other("The index path is not a directory."));
    }
    Ok(true)
}

fn retire_legacy_catalog(directory: &Path) -> io::Result<()> {
    // Attempt the database first. Windows refuses this while the old SQLite
    // connection is open, so its journal files remain intact in that case.
    for name in LEGACY_FILES {
        let file = directory.join(name);
        match fs::remove_file(&file) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retirement_only_removes_legacy_catalog_files() {
        let dir =
            std::env::temp_dir().join(format!("stratum-catalog-retirement-{}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        for name in LEGACY_FILES
            .into_iter()
            .chain([CATALOG_FILENAME, "keep.txt"])
        {
            fs::write(dir.join(name), name).unwrap();
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            let locked = fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(dir.join("catalog.db"))
                .unwrap();
            assert!(retire_legacy_catalog(&dir).is_err());
            assert!(dir.join("catalog.db-wal").exists());
            drop(locked);
        }
        retire_legacy_catalog(&dir).unwrap();
        retire_legacy_catalog(&dir).unwrap();
        for name in LEGACY_FILES {
            assert!(!dir.join(name).exists());
        }
        for name in [CATALOG_FILENAME, "keep.txt"] {
            assert_eq!(fs::read_to_string(dir.join(name)).unwrap(), name);
            fs::remove_file(dir.join(name)).unwrap();
        }
        fs::remove_dir(dir).unwrap();
    }
}
