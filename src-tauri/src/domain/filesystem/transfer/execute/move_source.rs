// A copy-then-delete move can outlive the source tree it enumerated. Record the
// objects actually copied and retire only those objects after publication.
use super::super::common::{transfer_entry_kind, TransferEntryKind};
use super::super::manifest::{TransferManifestEntry, TransferManifestRoot};
use crate::domain::filesystem::EntryIdentity;
use std::io;
use std::path::Path;
use std::time::SystemTime;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows::SourceFile;

#[cfg(unix)]
struct SourceFile(std::fs::Metadata);

#[cfg(unix)]
impl SourceFile {
    fn open(path: &Path, _for_cleanup: bool) -> io::Result<Self> {
        std::fs::symlink_metadata(path).map(Self)
    }

    fn metadata(&self) -> io::Result<std::fs::Metadata> {
        Ok(self.0.clone())
    }

    fn identity(&self) -> io::Result<(u64, u128)> {
        use std::os::unix::fs::MetadataExt;
        Ok((self.0.dev(), u128::from(self.0.ino())))
    }

    fn change_time(&self) -> io::Result<Option<i128>> {
        use std::os::unix::fs::MetadataExt;
        Ok(Some(
            i128::from(self.0.ctime()) * 1_000_000_000 + i128::from(self.0.ctime_nsec()),
        ))
    }

    fn remove(&self, entry: &TransferManifestEntry) -> io::Result<()> {
        if entry.kind.is_traversable_directory() {
            std::fs::remove_dir(&entry.source)
        } else {
            std::fs::remove_file(&entry.source)
        }
    }
}

#[derive(PartialEq)]
pub(super) struct SourceSnapshot {
    identity: (u64, u128),
    kind: TransferEntryKind,
    // Removing the copied children changes their parent's timestamp. The OS
    // checks for any remaining children when we request an empty-dir removal.
    file_version: Option<(u64, SystemTime)>,
    change_time: Option<i128>,
}

impl SourceSnapshot {
    fn read(file: &SourceFile, entry: &TransferManifestEntry) -> io::Result<Self> {
        let metadata = file.metadata()?;
        let kind = transfer_entry_kind(&entry.source, &metadata);
        let file_version = if kind.is_traversable_directory() {
            None
        } else {
            Some((metadata.len(), metadata.modified()?))
        };
        Ok(Self {
            identity: file.identity()?,
            kind,
            file_version,
            change_time: if file_version.is_some() {
                file.change_time()?
            } else {
                None
            },
        })
    }

    pub(super) fn copy(
        entry: &TransferManifestEntry,
        copy: impl FnOnce() -> Result<(), String>,
    ) -> Result<Self, String> {
        // Hold the Windows read handle until CopyFile2 finishes so both
        // operations see the same file, even if a writer wants to replace it.
        let source = SourceFile::open(&entry.source, false)
            .map_err(|err| format!("{}: {err}", entry.source.display()))?;
        let snapshot = Self::read(&source, entry)
            .map_err(|err| format!("{}: {err}", entry.source.display()))?;
        if snapshot.kind != entry.kind {
            return Err(format!(
                "Source changed before copying {}",
                entry.source.display()
            ));
        }
        copy()?;
        Ok(snapshot)
    }
}

// Keep the exact source locked against replacement while a caller copies it.
// The snapshot is later checked again by the existing verified move cleanup.
#[cfg(windows)]
pub(crate) struct PinnedMoveSource {
    _guard: SourceFile,
    entry: TransferManifestEntry,
    snapshot: SourceSnapshot,
}

#[cfg(windows)]
impl PinnedMoveSource {
    pub(crate) fn open(path: &Path, directory: bool) -> Result<Self, String> {
        let entry = TransferManifestEntry {
            source: path.to_owned(),
            destination: path.to_owned(),
            kind: if directory {
                TransferEntryKind::Directory
            } else {
                TransferEntryKind::File
            },
            bytes_total: 0,
        };
        let guard = SourceFile::open(path, false)
            .map_err(|error| format!("Could not lock {}: {error}", path.display()))?;
        let snapshot = SourceSnapshot::read(&guard, &entry)
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
        if snapshot.kind != entry.kind {
            return Err(format!("Source changed before copying {}", path.display()));
        }
        Ok(Self {
            _guard: guard,
            entry,
            snapshot,
        })
    }

    pub(crate) fn matches(&self, file: &std::fs::File) -> Result<(), String> {
        let identity = crate::domain::filesystem::file_identity::file_id(file)
            .map_err(|error| format!("Could not verify the source folder: {error}"))?;
        if identity != self.snapshot.identity {
            return Err("The source folder changed while opening it.".into());
        }
        Ok(())
    }
}

#[cfg(windows)]
#[derive(Default)]
pub(crate) struct CopiedMoveSources(Vec<(TransferManifestEntry, SourceSnapshot)>);

#[cfg(windows)]
impl CopiedMoveSources {
    pub(crate) fn record(&mut self, source: PinnedMoveSource) {
        self.0.push((source.entry, source.snapshot));
    }

    pub(crate) fn remove(mut self, destination: &str) -> Result<(), String> {
        // Preorder groups each directory's children directly after their parent.
        self.0
            .sort_unstable_by(|a, b| a.0.source.components().cmp(b.0.source.components()));
        let (entries, snapshots): (Vec<_>, Vec<_>) = self.0.into_iter().unzip();
        let first = entries.first().ok_or("No copied sources to clean up.")?;
        let root = TransferManifestRoot {
            source: first.source.clone(),
            destination: destination.into(),
            kind: first.kind,
            entries,
            file_count: 0,
            byte_count: 0,
        };
        remove_manifest_source(&root, &snapshots)
    }
}

// A verified cross-volume move copies from the exact source root. Windows
// denies renames while this read handle is open. Cleanup checks the copied
// identity again with the delete handle after the read handle is released.
pub(super) fn pin_expected_source(path: &Path, expected: &EntryIdentity) -> io::Result<impl Sized> {
    let source = SourceFile::open(path, false)?;
    expected.verify(source.identity()?)?;
    Ok(source)
}

struct MoveCleanup<'a> {
    #[cfg(windows)]
    aliases: windows::LinkedSources,
    // A reader protecting another hard link can defer deletion of its directory
    // until the last copied name is retired. Keep its verified handle to retry.
    pending_dirs: Vec<(SourceFile, &'a TransferManifestEntry)>,
}

impl<'a> MoveCleanup<'a> {
    fn remove_entry_tree(
        &mut self,
        entry: &'a TransferManifestEntry,
        snapshot: &SourceSnapshot,
        remaining: &mut std::iter::Peekable<
            impl Iterator<Item = (&'a TransferManifestEntry, &'a SourceSnapshot)>,
        >,
    ) -> Result<(), String> {
        let path = &entry.source;
        let retained =
            |err: io::Error| format!("Could not finish move cleanup at {}: {err}", path.display());
        let file = match SourceFile::open(path, true) {
            Ok(file) => file,
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                while remaining
                    .next_if(|(child, _)| child.source.starts_with(path))
                    .is_some()
                {}
                return Ok(());
            }
            Err(err) => return Err(retained(err)),
        };
        let current = SourceSnapshot::read(&file, entry).map_err(retained)?;
        #[cfg(windows)]
        let matches = self
            .aliases
            .verify(entry, snapshot, current)
            .map_err(retained)?;
        #[cfg(unix)]
        let matches = current == *snapshot;
        if !matches {
            return Err(format!(
                "Source changed during the move and was kept: {}",
                path.display()
            ));
        }

        // The manifest is in preorder. Hold each verified Windows parent handle
        // while descending so a renamed folder or junction cannot redirect cleanup.
        while let Some((child, snapshot)) =
            remaining.next_if(|(child, _)| child.source.parent() == Some(path))
        {
            self.remove_entry_tree(child, snapshot, remaining)?;
        }
        match file.remove(entry) {
            Ok(()) => Ok(()),
            #[cfg(windows)]
            Err(err)
                if entry.kind.is_traversable_directory()
                    && err.kind() == io::ErrorKind::DirectoryNotEmpty
                    && (self.aliases.has_guards() || !self.pending_dirs.is_empty()) =>
            {
                self.pending_dirs.push((file, entry));
                Ok(())
            }
            Err(err) => Err(retained(err)),
        }
    }
}

pub(super) fn remove_manifest_source(
    root: &TransferManifestRoot,
    snapshots: &[SourceSnapshot],
) -> Result<(), String> {
    if snapshots.len() != root.entries.len() {
        return Err("Incomplete move source record".to_string());
    }
    let mut cleanup = MoveCleanup {
        #[cfg(windows)]
        aliases: windows::LinkedSources::new(snapshots),
        pending_dirs: Vec::new(),
    };
    let copied = |err| format!("Copied to {}. {err}", root.destination.display());
    let mut remaining = root.entries.iter().zip(snapshots).peekable();
    if let Some((entry, snapshot)) = remaining.next() {
        cleanup
            .remove_entry_tree(entry, snapshot, &mut remaining)
            .map_err(copied)?;
    }
    #[cfg(windows)]
    drop(cleanup.aliases);
    for (directory, entry) in cleanup.pending_dirs {
        directory.remove(entry).map_err(|err| {
            copied(format!(
                "Could not finish move cleanup at {}: {err}",
                entry.source.display()
            ))
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
