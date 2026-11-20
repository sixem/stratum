// Collect a standard-token baseline one durable directory at a time.
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
};

use crate::{
    domain::indexed_search::IndexedEntryKind, platform::windows::file_names::plain_component,
};

use super::{
    catalog::{
        recursive_build::{RecursiveBuild, CHUNK_SIZE},
        CatalogEntryRecord, IndexedCatalogStore,
    },
    scan::{
        can_descend_into, ensure_scan_not_cancelled, excluded_path, DriveScanCapture,
        DriveScanSource, DriveScanSummary,
    },
    watched_paths::{has_exact_name, pin_directory},
};

const CANCEL_INTERVAL: usize = 128;
const MAX_FRONTIER_DEPTH: usize = 512;

pub(super) fn scan(
    catalog: &IndexedCatalogStore,
    capture: &DriveScanCapture<'_>,
    started_at: u64,
    should_cancel: &impl Fn() -> bool,
    validate_mount: &impl Fn() -> Result<(), String>,
) -> Result<Option<DriveScanSummary>, String> {
    ensure_scan_not_cancelled(should_cancel)?;
    validate_mount()?;
    let Some(mut build) =
        RecursiveBuild::open(catalog, capture.drive_path, capture.volume_id, started_at)?
    else {
        // A complete snapshot must stay readable until its atomic refresh
        // publishes; never expose chunks written for its replacement.
        return Ok(None);
    };
    let resumed_at = build.entries;
    if resumed_at > 0 {
        eprintln!(
            "[indexed-search] scan: resuming {} with {resumed_at} durable entries",
            capture.drive_path
        );
    }
    build.clear_interrupted_directory(should_cancel)?;
    let volume = Path::new(capture.volume_guid);
    while let Some(relative) = build.next_directory()? {
        ensure_scan_not_cancelled(should_cancel)?;
        scan_directory(
            &mut build,
            volume,
            &relative,
            capture,
            should_cancel,
            validate_mount,
        )?;
    }
    let source = DriveScanSource::RecursiveFallback;
    build.publish(source.label(), || {
        ensure_scan_not_cancelled(should_cancel)?;
        validate_mount()
    })?;
    eprintln!(
        "[indexed-search] scan: recursive baseline complete drive={} entries={} resumed_at={resumed_at}",
        capture.drive_path, build.entries
    );
    Ok(Some(DriveScanSummary {
        entries_indexed: build.entries,
        source,
    }))
}

fn scan_directory(
    build: &mut RecursiveBuild,
    volume: &Path,
    relative: &str,
    capture: &DriveScanCapture<'_>,
    should_cancel: &impl Fn() -> bool,
    validate_mount: &impl Fn() -> Result<(), String>,
) -> Result<(), String> {
    let Some((directory, _pinned, depth)) = open_frontier(volume, relative) else {
        // A saved directory may have disappeared or changed into a junction
        // while the app was closed. Never traverse through that replacement.
        validate_mount()?;
        build.write_chunk(relative, &[], &[], 0, true)?;
        return Ok(());
    };
    let listing = match fs::read_dir(&directory) {
        Ok(listing) => listing,
        Err(error) if relative.is_empty() => {
            return Err(format!(
                "Failed to read indexed-search drive root {}: {error}",
                capture.drive_path
            ));
        }
        Err(_) => {
            validate_mount()?;
            build.write_chunk(relative, &[], &[], 0, true)?;
            return Ok(());
        }
    };
    let logical = Path::new(capture.drive_path).join(relative);
    let mut records = Vec::new();
    let mut children = Vec::new();
    let mut partial_count = 0;
    for (index, result) in listing.enumerate() {
        if index % CANCEL_INTERVAL == 0 {
            ensure_scan_not_cancelled(should_cancel)?;
        }
        let entry = match result {
            Ok(entry) => entry,
            Err(error) if relative.is_empty() => {
                return Err(format!(
                    "Failed to list indexed-search drive root {}: {error}",
                    capture.drive_path
                ));
            }
            Err(_) => continue,
        };
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let path = logical.join(name);
        if excluded_path(&path, capture.excluded_directory) {
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        let kind = if metadata.is_dir() {
            IndexedEntryKind::Directory
        } else {
            IndexedEntryKind::File
        };
        let Some(record) = CatalogEntryRecord::from_path(&path, kind) else {
            continue;
        };
        records.push(record);
        if metadata.is_dir()
            && can_descend_into(&metadata)
            && plain_component(name)
            && depth < MAX_FRONTIER_DEPTH
        {
            let child = if relative.is_empty() {
                name.to_owned()
            } else {
                format!("{relative}\\{name}")
            };
            children.push(child);
        }
        if records.len() == CHUNK_SIZE {
            ensure_scan_not_cancelled(should_cancel)?;
            partial_count += build.write_chunk(relative, &records, &children, 0, false)?;
            records.clear();
            children.clear();
        }
    }
    ensure_scan_not_cancelled(should_cancel)?;
    build.write_chunk(relative, &records, &children, partial_count, true)?;
    Ok(())
}

fn open_frontier(volume: &Path, relative: &str) -> Option<(PathBuf, Vec<File>, usize)> {
    let mut path = volume.to_path_buf();
    let mut pinned = Vec::new();
    if !relative.is_empty() {
        for component in relative.split('\\') {
            if !plain_component(component) || pinned.len() == MAX_FRONTIER_DEPTH {
                return None;
            }
            path.push(component);
            let directory = pin_directory(&path).ok()?;
            if !has_exact_name(&path).ok()? {
                return None;
            }
            pinned.push(directory);
        }
    }
    let depth = pinned.len();
    Some((path, pinned, depth))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{domain::indexed_search::IndexedPathQuery, services::indexed_search::windows};
    use std::{
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "stratum-resumable-scan-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
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

    #[test]
    fn resumable_scan_uses_guid_paths_and_skips_a_junction_installed_after_checkpoint() {
        let fixture = Fixture::new();
        let source = fixture.0.join("source");
        fs::create_dir(&source).unwrap();
        fs::create_dir(source.join("redirected")).unwrap();
        fs::create_dir(source.join("ordinary")).unwrap();
        fs::create_dir(fixture.0.join("other")).unwrap();
        fs::write(fixture.0.join("other").join("outside.txt"), "").unwrap();
        fs::write(source.join("durable-root.txt"), "").unwrap();
        fs::write(source.join("ordinary").join("ordinary-child.txt"), "").unwrap();

        let root = source.ancestors().last().unwrap();
        let drive = root.to_str().unwrap().to_ascii_uppercase();
        let physical_volume = windows::discover_drive(&drive);
        let guid = physical_volume.volume_guid.unwrap();
        let volume_id = physical_volume.volume_identity.unwrap();
        let physical_root = Path::new(&guid).join(source.strip_prefix(root).unwrap());
        let capture = DriveScanCapture {
            drive_path: &drive,
            volume_guid: physical_root.to_str().unwrap(),
            volume_id: &volume_id,
            checkpoint: None,
            excluded_directory: None,
        };
        let store = IndexedCatalogStore::open(fixture.0.join("catalog.db")).unwrap();
        let stop_after_root = || {
            store.connect().unwrap().query_row(
                "SELECT EXISTS(SELECT 1 FROM indexed_recursive_builds WHERE completed_entries > 0)",
                [],
                |row| row.get(0),
            ).unwrap()
        };
        assert!(matches!(
            scan(&store, &capture, 1, &stop_after_root, &|| Ok(())),
            Err(error) if error == super::super::scan::SCAN_CANCELLED_MESSAGE
        ));
        assert!(store.load_ready_drive_snapshots().unwrap().is_empty());

        fs::remove_file(source.join("durable-root.txt")).unwrap();
        fs::remove_dir(source.join("redirected")).unwrap();
        let junction = Command::new("cmd.exe")
            .current_dir(&fixture.0)
            .args(["/d", "/c", "mklink", "/j", "source\\redirected", "other"])
            .output()
            .unwrap();
        assert!(
            junction.status.success(),
            "{}",
            String::from_utf8_lossy(&junction.stderr)
        );

        let scan = scan(&store, &capture, 2, &|| false, &|| Ok(()))
            .unwrap()
            .unwrap();
        assert_eq!(scan.entries_indexed, 4);
        let search = |name: &str| {
            store
                .query(
                    IndexedPathQuery {
                        query: name.into(),
                        limit: Some(10),
                    },
                    &[(drive.clone(), volume_id.clone())],
                )
                .unwrap()
        };
        // The completed root survives reopening, while only the pending
        // ordinary directory is traversed in the second invocation.
        assert_eq!(search("durable-root").len(), 1);
        assert_eq!(search("ordinary-child").len(), 1);
        assert!(search("outside").is_empty());
    }
}
