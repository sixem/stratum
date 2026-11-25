// Own temporary drop contents until the file operation that consumes them finishes.
use super::data::DropDataError;
use super::stage_slots::{StageSlot, StageSlots};
use crate::domain::filesystem::file_identity::file_id;
use crate::platform::windows::file_names::plain_component;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{self, ErrorKind, Read};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use windows::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
};

mod budget;
mod pinned;
pub(super) use budget::{copy_stream, StagingBudget, MAX_DEPTH, MAX_ITEMS};
pub(super) use pinned::{prepare_hdrop_paths, PinnedDrop, PreparedHdrop};

const DROP_ROOT_DIR: &str = "stratum-drop";
static DROP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(super) struct ReceivedFiles {
    pub(super) paths: Vec<String>,
    pub(super) stage: Option<DropStage>,
}

impl ReceivedFiles {
    pub(super) fn direct(paths: Vec<String>) -> Self {
        Self { paths, stage: None }
    }

    pub(super) fn staged(paths: Vec<String>, stage: DropStage) -> Self {
        Self {
            paths,
            stage: Some(stage),
        }
    }
}

pub(crate) struct DropStage {
    directory: StageDirectory,
    slot: StageSlot,
}

impl DropStage {
    pub(super) fn new(slots: &StageSlots) -> Result<Self, DropDataError> {
        Self::in_root(&std::env::temp_dir().join(DROP_ROOT_DIR), slots)
    }

    fn in_root(root: &Path, slots: &StageSlots) -> Result<Self, DropDataError> {
        let slot = slots.reserve()?;
        let directory = StageDirectory::create(root).map_err(DropDataError::from_staging_io)?;
        Ok(Self { directory, slot })
    }

    pub(super) fn path(&self) -> &Path {
        &self.directory.path
    }
}

impl Drop for DropStage {
    fn drop(&mut self) {
        if self.directory.cleanup().is_err() {
            self.slot.defer_cleanup(self.directory.clone());
        }
    }
}

#[derive(Clone)]
pub(super) struct StageDirectory {
    path: PathBuf,
    identity: Option<(u64, u128)>,
}

impl StageDirectory {
    fn create(root: &Path) -> io::Result<Self> {
        fs::create_dir_all(root)?;
        if is_reparse(&fs::symlink_metadata(root)?) {
            return Err(io::Error::other("Drop staging location is a reparse point"));
        }
        loop {
            let counter = DROP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = root.join(format!("drop-{}-{counter}", std::process::id()));
            // Only take ownership of a directory we created. An interrupted earlier
            // instance or another process may already have claimed the name.
            match fs::create_dir(&path) {
                Ok(()) => {
                    let identity = stage_directory_identity(&path).ok();
                    return Ok(Self { path, identity });
                }
                Err(err) if err.kind() == ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(err),
            }
        }
    }

    pub(super) fn retry_cleanup(&self) -> io::Result<()> {
        // A directory with an unknown identity can get its initial cleanup,
        // but its name alone is not enough to retry deletion later.
        if self.identity.is_none() {
            return Err(io::Error::other(
                "Drop staging directory identity is unknown",
            ));
        }
        self.cleanup()
    }

    fn cleanup(&self) -> io::Result<()> {
        let path = &self.path;
        let parent = path.parent().expect("staged drop has a parent directory");
        let metadata = match fs::symlink_metadata(parent) {
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
            result => result?,
        };
        if is_reparse(&metadata) {
            return Err(io::Error::other("Drop staging location is a reparse point"));
        }
        if let Some(expected) = self.identity {
            match stage_directory_identity(path) {
                Ok(current) if current == expected => {}
                Ok(_) => return Err(io::Error::other("Drop staging directory was replaced")),
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(error),
            }
        }

        remove_if_present(path).or_else(|_| {
            // Keep read-only repair inside the stage and never change a linked target.
            let _ = clear_readonly(path);
            remove_if_present(path)
        })
    }
}

fn stage_directory_identity(path: &Path) -> io::Result<(u64, u128)> {
    let directory = File::options()
        .read(true)
        .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0 | FILE_SHARE_DELETE.0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)?;
    let metadata = directory.metadata()?;
    if is_reparse(&metadata) || !metadata.is_dir() {
        return Err(io::Error::other(
            "Drop staging path is no longer a regular directory",
        ));
    }
    file_id(&directory)
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        // A missing child can interrupt the recursive deletion. Only give
        // back the slot once the stage directory itself is gone.
        Err(error) if error.kind() == ErrorKind::NotFound => match fs::symlink_metadata(path) {
            Err(probe) if probe.kind() == ErrorKind::NotFound => Ok(()),
            _ => Err(error),
        },
        result => result,
    }
}

fn is_reparse(meta: &fs::Metadata) -> bool {
    meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
}

fn clear_readonly(path: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if is_reparse(&meta) {
        return Ok(());
    }
    if meta.is_dir() {
        for entry in fs::read_dir(path)? {
            clear_readonly(&entry?.path())?;
        }
    }
    if meta.permissions().readonly() {
        let mut permissions = meta.permissions();
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

fn in_temp(path: &Path, temp: &Path) -> bool {
    use std::path::{Component, Prefix};
    let mut parts = path.components();
    temp.components()
        .all(|expected| match (parts.next(), expected) {
            (Some(Component::Prefix(a)), Component::Prefix(b)) => match (a.kind(), b.kind()) {
                (
                    Prefix::Disk(a) | Prefix::VerbatimDisk(a),
                    Prefix::Disk(b) | Prefix::VerbatimDisk(b),
                ) => a.eq_ignore_ascii_case(&b),
                (
                    Prefix::UNC(a, x) | Prefix::VerbatimUNC(a, x),
                    Prefix::UNC(b, y) | Prefix::VerbatimUNC(b, y),
                ) => a.eq_ignore_ascii_case(b) && x.eq_ignore_ascii_case(y),
                _ => a.as_os_str().eq_ignore_ascii_case(b.as_os_str()),
            },
            (Some(part), prefix) => part.as_os_str().eq_ignore_ascii_case(prefix.as_os_str()),
            _ => false,
        })
}

#[cfg(test)]
fn stage_from(
    paths: &[String],
    temp: &Path,
    slots: &StageSlots,
    budget_for: impl FnOnce(&Path) -> Result<StagingBudget, DropDataError>,
) -> Result<ReceivedFiles, DropDataError> {
    pinned::prepare_from(paths.to_vec(), temp, slots, budget_for)?.materialize()
}

pub(super) fn stage_filesystem_item(
    source: &Path,
    stage_root: &Path,
    parent: &Path,
    depth: usize,
    budget: &mut StagingBudget,
) -> Result<PathBuf, DropDataError> {
    let (handle, metadata) = open_stage_source(source)?;
    if metadata.is_dir() {
        check_stage_directory(source, stage_root)?;
    }
    copy_stage_source(source, handle, metadata, parent, depth, budget)
}

fn check_stage_directory(source: &Path, stage: &Path) -> Result<(), DropDataError> {
    // A provider can offer the temp root or an alias of the staging folder.
    let source = fs::canonicalize(source).map_err(|_| DropDataError::InvalidSource)?;
    let stage = fs::canonicalize(stage).map_err(|_| DropDataError::StagingFailed)?;
    if in_temp(&stage, &source) {
        return Err(DropDataError::InvalidSource);
    }
    Ok(())
}

fn open_stage_source(path: &Path) -> Result<(File, fs::Metadata), DropDataError> {
    open_stage_source_with_sharing(path, FILE_SHARE_READ.0)
}

fn open_stage_source_with_sharing(
    path: &Path,
    share: u32,
) -> Result<(File, fs::Metadata), DropDataError> {
    // Open the path itself and check its attributes on the same handle.
    let file = File::options()
        .read(true)
        .share_mode(share)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
        .map_err(|_| DropDataError::InvalidSource)?;
    let metadata = file.metadata().map_err(|_| DropDataError::InvalidSource)?;
    if is_reparse(&metadata) || !(metadata.is_file() || metadata.is_dir()) {
        return Err(DropDataError::InvalidSource);
    }
    Ok((file, metadata))
}

pub(super) fn reserve_stage_entry(
    depth: usize,
    budget: &mut StagingBudget,
) -> Result<(), DropDataError> {
    if depth > MAX_DEPTH {
        return Err(DropDataError::TooDeep);
    }
    budget.reserve_entry()
}

// Consult the actual destination filesystem and reserve the name atomically.
// A case-insensitive staging directory can receive case-distinct source names.
pub(super) fn create_stage_entry<T>(
    parent: &Path,
    name: &OsStr,
    create: impl Fn(&Path) -> io::Result<T>,
) -> Result<(PathBuf, T), DropDataError> {
    if !name.to_str().is_some_and(plain_component) {
        return Err(DropDataError::InvalidSource);
    }
    let original = parent.join(name);
    if let Some(value) = try_create_stage_entry(&original, &create)? {
        return Ok((original, value));
    }
    let name = Path::new(name);
    let stem = name.file_stem().unwrap_or_default();
    for number in 2.. {
        let mut name_with_number = stem.to_owned();
        name_with_number.push(format!(" ({number})"));
        if let Some(ext) = name.extension() {
            name_with_number.push(".");
            name_with_number.push(ext);
        }
        let candidate = parent.join(name_with_number);
        if let Some(value) = try_create_stage_entry(&candidate, &create)? {
            return Ok((candidate, value));
        }
    }
    unreachable!()
}

fn try_create_stage_entry<T>(
    path: &Path,
    create: &impl Fn(&Path) -> io::Result<T>,
) -> Result<Option<T>, DropDataError> {
    if path
        .try_exists()
        .map_err(|_| DropDataError::StagingFailed)?
    {
        return Ok(None);
    }
    match create(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(None),
        Err(error) => Err(DropDataError::from_staging_io(error)),
    }
}

fn copy_stage_source(
    source: &Path,
    handle: File,
    metadata: fs::Metadata,
    parent: &Path,
    depth: usize,
    budget: &mut StagingBudget,
) -> Result<PathBuf, DropDataError> {
    reserve_stage_entry(depth, budget)?;
    let name = source.file_name().ok_or(DropDataError::InvalidSource)?;
    if metadata.is_dir() {
        let (destination, ()) = create_stage_entry(parent, name, |path| fs::create_dir(path))?;
        let entries = fs::read_dir(source).map_err(|_| DropDataError::InvalidSource)?;
        for entry in entries {
            let entry = entry.map_err(|_| DropDataError::InvalidSource)?;
            let child = entry.path();
            let (child_handle, child_metadata) = open_stage_source(&child)?;
            copy_stage_source(
                &child,
                child_handle,
                child_metadata,
                &destination,
                depth + 1,
                budget,
            )?;
        }
        return Ok(destination);
    }

    copy_stage_file(name, handle, metadata, parent, budget)
}

fn copy_stage_file(
    name: &OsStr,
    mut handle: File,
    metadata: fs::Metadata,
    parent: &Path,
    budget: &mut StagingBudget,
) -> Result<PathBuf, DropDataError> {
    if metadata.len() > budget.remaining_bytes() {
        return Err(DropDataError::InsufficientSpace);
    }
    let (destination, mut file) = create_stage_entry(parent, name, |path| File::create_new(path))?;
    let mut buffer = vec![0; 64 * 1024];
    loop {
        let count = handle
            .read(&mut buffer)
            .map_err(|_| DropDataError::InvalidSource)?;
        if count == 0 {
            break;
        }
        budget.write(&mut file, &buffer[..count])?;
    }
    // Keep the selected file's modification time and read-only status.
    if let Ok(modified) = metadata.modified() {
        file.set_modified(modified)
            .map_err(|_| DropDataError::StagingFailed)?;
    }
    file.set_permissions(metadata.permissions())
        .map_err(|_| DropDataError::StagingFailed)?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::windows::dragdrop::{stage_slots::MAX_STAGED_DROPS, IncomingDrops};
    use std::process::Command;

    fn fixture() -> DropStage {
        DropStage::in_root(&std::env::temp_dir(), &StageSlots::default()).unwrap()
    }

    fn name(path: &Path) -> String {
        path.to_str().unwrap().to_owned()
    }

    fn stage_test_paths(
        paths: &[String],
        temp: &Path,
        budget: StagingBudget,
    ) -> Result<ReceivedFiles, DropDataError> {
        stage_from(paths, temp, &StageSlots::default(), |_| Ok(budget))
    }

    #[test]
    fn retained_stages_share_capacity_without_blocking_direct_paths() {
        let fixture = fixture();
        let temp = fixture.path().join("temp");
        let root = temp.join(DROP_ROOT_DIR);
        let incoming = IncomingDrops::default();
        incoming.subscribe("main");
        let generation = incoming.generation("main").unwrap();
        let mut retained = (0..MAX_STAGED_DROPS)
            .map(|_| {
                incoming
                    .retain(
                        "main",
                        generation,
                        DropStage::in_root(&root, &incoming.staging_slots).unwrap(),
                        &[],
                    )
                    .unwrap()
            })
            .collect::<Vec<_>>();
        let temporary = temp.join("temporary.txt");
        let ordinary = fixture.path().join("ordinary.txt");
        fs::write(&temporary, "staged").unwrap();
        fs::write(&ordinary, "direct").unwrap();

        let stage = || {
            stage_from(
                &[name(&temporary)],
                &temp,
                &incoming.staging_slots,
                StagingBudget::for_directory,
            )
        };
        assert!(matches!(stage(), Err(DropDataError::StagingBusy)));
        assert_eq!(fs::read_dir(&root).unwrap().count(), MAX_STAGED_DROPS);
        let direct = stage_from(&[name(&ordinary)], &temp, &incoming.staging_slots, |_| {
            panic!("Direct paths do not need temporary storage")
        })
        .unwrap();
        assert_eq!(direct.paths, [name(&ordinary)]);
        assert!(direct.stage.is_none());

        incoming.release("main", retained.pop().unwrap());
        let replacement = stage().unwrap();
        assert!(replacement.stage.is_some());
        for id in retained {
            incoming.release("main", id);
        }
        drop(replacement);
        assert_eq!(fs::read_dir(root).unwrap().count(), 0);
    }

    #[test]
    fn failed_cleanup_stays_charged_until_the_directory_is_removed() {
        let fixture = fixture();
        let root = fixture.path();
        let slots = StageSlots::default();
        let retained = (1..MAX_STAGED_DROPS)
            .map(|_| DropStage::in_root(root, &slots).unwrap())
            .collect::<Vec<_>>();
        let stage = DropStage::in_root(root, &slots).unwrap();
        let path = stage.path().to_owned();
        let locked = path.join("locked.txt");
        fs::write(&locked, "contents").unwrap();
        let lock = File::options()
            .read(true)
            .share_mode(0)
            .open(&locked)
            .unwrap();

        drop(stage);
        assert!(path.exists());
        assert!(matches!(
            DropStage::in_root(root, &slots),
            Err(DropDataError::StagingBusy)
        ));
        drop(lock);
        let replacement = DropStage::in_root(root, &slots).unwrap();
        assert!(!path.exists());
        assert!(matches!(
            DropStage::in_root(root, &slots),
            Err(DropDataError::StagingBusy)
        ));
        drop(replacement);
        drop(retained);
        assert_eq!(fs::read_dir(root).unwrap().count(), 0);
    }

    #[test]
    fn delayed_cleanup_leaves_a_replacement_directory_untouched() {
        let fixture = fixture();
        let root = fixture.path();
        let slots = StageSlots::default();
        let _other_slots = (1..MAX_STAGED_DROPS)
            .map(|_| slots.reserve().unwrap())
            .collect::<Vec<_>>();
        let stage = DropStage::in_root(root, &slots).unwrap();
        let path = stage.path().to_owned();
        let locked = path.join("locked.txt");
        fs::write(&locked, "original").unwrap();
        let lock = File::options()
            .read(true)
            .share_mode(0)
            .open(locked)
            .unwrap();
        drop(stage);
        drop(lock);

        let renamed = root.join("renamed");
        fs::rename(&path, &renamed).unwrap();
        fs::create_dir(&path).unwrap();
        let unrelated = path.join("keep.txt");
        fs::write(&unrelated, "unrelated").unwrap();

        assert!(matches!(slots.reserve(), Err(DropDataError::StagingBusy)));
        assert_eq!(fs::read(unrelated).unwrap(), b"unrelated");
        assert_eq!(fs::read(renamed.join("locked.txt")).unwrap(), b"original");

        fs::remove_dir_all(&path).unwrap();
        fs::rename(&renamed, &path).unwrap();
        assert!(slots.reserve().is_ok());
        assert!(!path.exists());
    }

    #[test]
    fn temp_detection_recognizes_extended_paths_and_preserves_folder_boundaries() {
        assert!(in_temp(
            Path::new(r"\\?\c:\tmp\archived"),
            Path::new(r"C:\TMP")
        ));
        assert!(in_temp(
            Path::new(r"\\?\UNC\server\Share\tmp\a"),
            Path::new(r"\\server\share\tmp")
        ));
        assert!(!in_temp(Path::new(r"C:\tmp-old\a"), Path::new(r"C:\tmp")));
    }

    #[test]
    fn temp_drop_preserves_case_collisions_and_only_removes_owned_paths() {
        let fixture = fixture();
        let temp = fixture.path().join("TEMP");
        let direct = fixture.path().join("keep.txt");
        fs::write(&direct, "live").unwrap();
        let first = temp.join("left").join("Sample.txt");
        let second = temp.join("right").join("sample.txt");
        for (path, contents) in [(&first, "one"), (&second, "two")] {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }
        let inputs = vec![name(&first), name(&direct), name(&second)];
        let files = stage_test_paths(&inputs, &temp, StagingBudget::with_limits(2, 6)).unwrap();
        let stage_path = files.stage.as_ref().unwrap().path().to_owned();
        assert_eq!(files.paths[1], inputs[1]);
        for (index, contents) in ["one", "live", "two"].into_iter().enumerate() {
            assert_eq!(fs::read_to_string(&files.paths[index]).unwrap(), contents);
        }
        drop(files);
        assert!(!stage_path.exists());
        assert!(inputs.iter().all(|path| Path::new(path).is_file()));
    }

    #[test]
    fn partial_temp_stage_discards_its_readonly_files() {
        let fixture = fixture();
        let source = fixture.path().join("source.txt");
        fs::write(&source, "original").unwrap();
        let mut attributes = fs::metadata(&source).unwrap().permissions();
        attributes.set_readonly(true);
        fs::set_permissions(&source, attributes).unwrap();
        let missing = fixture.path().join("no such item");
        assert!(stage_test_paths(
            &[name(&source), name(&missing)],
            fixture.path(),
            StagingBudget::with_limits(MAX_ITEMS, 128)
        )
        .is_err());
        let root = fixture.path().join(DROP_ROOT_DIR);
        assert_eq!(fs::read_dir(root).unwrap().count(), 0);
        assert!(fs::metadata(source).unwrap().permissions().readonly());
    }

    #[test]
    fn temporary_ancestor_and_nested_junction_never_recurse_into_the_stage() {
        let fixture = fixture();
        let temp = fixture.path();
        let nested = temp.join("archive");
        fs::create_dir(&nested).unwrap();
        let status = Command::new("cmd")
            .args(["/d", "/c", "mklink", "/j"])
            .arg(nested.join("back"))
            .arg(temp)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
        let budget = || StagingBudget::with_limits(MAX_ITEMS, 128);
        assert!(stage_test_paths(&[name(temp)], temp, budget()).is_err());
        assert!(stage_test_paths(&[name(&nested)], temp, budget()).is_err());
        let via_alias = nested.join("back").join("archive").join("back");
        assert!(stage_test_paths(&[name(&via_alias)], temp, budget()).is_err());
        assert!(nested.join("back").exists());
        assert_eq!(fs::read_dir(temp.join(DROP_ROOT_DIR)).unwrap().count(), 0);
    }

    #[test]
    fn temp_hdrop_shares_the_byte_budget_across_a_directory_tree() {
        let fixture = fixture();
        let temp = fixture.path();
        let directory = temp.join("selection");
        fs::create_dir(&directory).unwrap();
        for child in ["one.txt", "two.txt"] {
            fs::write(directory.join(child), b"abc").unwrap();
        }
        let paths = [name(&directory)];
        let result = stage_test_paths(&paths, temp, StagingBudget::with_limits(3, 5));
        assert!(matches!(result, Err(DropDataError::InsufficientSpace)));
        assert_eq!(fs::read_dir(temp.join(DROP_ROOT_DIR)).unwrap().count(), 0);
        assert_eq!(fs::read_dir(directory).unwrap().count(), 2);
    }

    #[test]
    fn temp_hdrop_counts_directories_and_rejects_excess_nesting() {
        let fixture = fixture();
        let temp = fixture.path();
        let directory = temp.join("selection");
        let deep = (0..MAX_DEPTH).fold(directory.clone(), |path, _| path.join("a"));
        fs::create_dir_all(deep).unwrap();
        let all = [name(&directory)];
        let result = stage_test_paths(&all, temp, StagingBudget::with_limits(2, 0));
        assert!(matches!(result, Err(DropDataError::TooManyItems)));
        let result = stage_test_paths(&all, temp, StagingBudget::with_limits(MAX_ITEMS, 0));
        assert!(matches!(result, Err(DropDataError::TooDeep)));
        assert_eq!(fs::read_dir(temp.join(DROP_ROOT_DIR)).unwrap().count(), 0);
    }
}
