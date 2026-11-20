// Encode privately. Only the short publication step can change a selected original.
use super::ConversionJobItem;
use crate::domain::filesystem::{
    file_identity::file_id,
    staging::{rename_new, StageDirectory},
};
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

// Keep the file object alive to prevent ID reuse while the encoder is running.
// On Windows allow renames but exclude in-place writers. Verify the actual
// staged object before retiring it, even if another app replaced the name.
struct Original {
    path: PathBuf,
    _file: File,
    version: ((u64, u128), u64, SystemTime),
}

impl Original {
    fn open(path: &Path) -> io::Result<Self> {
        let mut options = File::options();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::{
                FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
            };
            options
                .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        let file = options.open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || fs::symlink_metadata(path)?.is_symlink() {
            return Err(io::Error::other("Only a regular file can be replaced"));
        }
        let version = (file_id(&file)?, metadata.len(), metadata.modified()?);
        Ok(Self {
            path: path.into(),
            _file: file,
            version,
        })
    }
}

pub(super) struct ConversionOutput {
    pub(super) payload: PathBuf,
    destination: PathBuf,
    _workspace: StageDirectory,
    originals: Vec<Original>,
}

impl ConversionOutput {
    pub(super) fn prepare(item: &ConversionJobItem) -> Result<Self, String> {
        let destination = Path::new(item.destination_path().trim());
        let parent = destination.parent().ok_or("Missing output folder")?;
        fs::create_dir_all(parent)
            .map_err(|err| format!("Cannot open {}: {err}", parent.display()))?;
        let mut originals = Vec::new();
        if item.delete_source_after_success() {
            let source = Path::new(item.source_path().trim());
            originals.push(
                Original::open(source)
                    .map_err(|err| format!("Cannot replace {}: {err}", source.display()))?,
            );
        }
        match fs::symlink_metadata(destination) {
            Ok(_) if !item.overwrite() => {
                return Err(format!("Output already exists: {}", destination.display()))
            }
            Ok(_) => originals.push(
                Original::open(destination)
                    .map_err(|err| format!("Cannot replace {}: {err}", destination.display()))?,
            ),
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => return Err(format!("Cannot check {}: {err}", destination.display())),
        }
        let workspace = StageDirectory::beside(destination, "conversion")
            .map_err(|err| format!("Cannot stage output in {}: {err}", parent.display()))?;
        let mut payload = workspace.path.join("output");
        if let Some(extension) = destination.extension() {
            payload.set_extension(extension);
        }
        Ok(Self {
            payload,
            destination: destination.into(),
            _workspace: workspace,
            originals,
        })
    }

    pub(super) fn discard(&self) -> Result<(), String> {
        match retry_sharing(|| fs::remove_file(&self.payload)) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(format!(
                "Could not remove temporary output {}: {err}",
                self.payload.display()
            )),
        }
    }

    pub(super) fn commit(self) -> Result<Option<String>, String> {
        let mut backups = Vec::new();
        let publish = (|| {
            for original in &self.originals {
                // Each backup stays on its own volume, including for an explicit output folder.
                let directory = StageDirectory::beside(&original.path, "conversion-backup")
                    .map_err(|err| format!("Cannot stage {}: {err}", original.path.display()))?;
                let backup = directory.path.join("original");
                retry_sharing(|| rename_new(&original.path, &backup))
                    .map_err(|err| format!("Cannot stage {}: {err}", original.path.display()))?;
                backups.push((original.path.clone(), directory));
                if Original::open(&backup).map(|file| file.version).ok() != Some(original.version) {
                    return Err(format!(
                        "{} changed during conversion",
                        original.path.display()
                    ));
                }
            }
            // A file created after planning or while originals were staged belongs to its creator.
            retry_sharing(|| rename_new(&self.payload, &self.destination))
                .map_err(|err| format!("Cannot publish {}: {err}", self.destination.display()))
        })();
        if let Err(mut error) = publish {
            for (original, directory) in backups.into_iter().rev() {
                let backup = directory.path.join("original");
                if let Err(restore) = retry_sharing(|| rename_new(&backup, &original)) {
                    error.push_str(&format!(
                        ". Could not restore {} ({restore}). Recover it from {}",
                        original.display(),
                        backup.display()
                    ));
                }
            }
            if let Err(cleanup) = self.discard() {
                error.push_str(&format!(". {cleanup}"));
            }
            return Err(error);
        }
        // Publication is final. A cleanup error must never roll back an output
        // after a previous backup has already been permanently removed.
        drop(self.originals);
        Ok(cleanup_backups(&self.destination, backups))
    }
}

pub(super) fn cleanup_backups(
    destination: &Path,
    backups: Vec<(PathBuf, StageDirectory)>,
) -> Option<String> {
    let mut failures = Vec::new();
    for (_, directory) in backups {
        let backup = directory.path.join("original");
        if let Err(err) = retry_sharing(|| fs::remove_file(&backup)) {
            failures.push(format!("{} ({err})", backup.display()));
        }
    }
    if failures.is_empty() {
        return None;
    }
    Some(format!(
        "Saved {}. Could not remove backups: {}",
        destination.display(),
        failures.join(", ")
    ))
}

fn retry_sharing<T>(mut operation: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    for _ in 0..7 {
        match operation() {
            Err(err) if matches!(err.raw_os_error(), Some(32 | 33)) => {
                std::thread::sleep(Duration::from_millis(60));
            }
            result => return result,
        }
    }
    operation()
}
