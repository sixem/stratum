// Keep temporary CF_HDROP files readable after their provider deletes the names.
use super::{
    check_stage_directory, copy_stage_file, create_stage_entry, in_temp, open_stage_source,
    open_stage_source_with_sharing, reserve_stage_entry, DropDataError, DropStage, ReceivedFiles,
    StageSlots, StagingBudget, DROP_ROOT_DIR,
};
use std::ffi::OsString;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use windows::Win32::Storage::FileSystem::{FILE_SHARE_DELETE, FILE_SHARE_READ};

pub(in crate::platform::windows::dragdrop) enum PreparedHdrop {
    Direct(Vec<String>),
    Temporary(PinnedDrop),
}

impl PreparedHdrop {
    pub(in crate::platform::windows::dragdrop) fn materialize(
        self,
    ) -> Result<ReceivedFiles, DropDataError> {
        match self {
            Self::Direct(paths) => Ok(ReceivedFiles::direct(paths)),
            Self::Temporary(drop) => drop.materialize(),
        }
    }
}

pub(in crate::platform::windows::dragdrop) fn prepare_hdrop_paths(
    paths: Vec<String>,
    slots: &StageSlots,
) -> Result<PreparedHdrop, DropDataError> {
    prepare_from(
        paths,
        &std::env::temp_dir(),
        slots,
        StagingBudget::for_directory,
    )
}

pub(super) fn prepare_from(
    paths: Vec<String>,
    temp: &Path,
    slots: &StageSlots,
    budget_for: impl FnOnce(&Path) -> Result<StagingBudget, DropDataError>,
) -> Result<PreparedHdrop, DropDataError> {
    if !paths.iter().any(|path| in_temp(Path::new(path), temp)) {
        return Ok(PreparedHdrop::Direct(paths));
    }

    let stage = DropStage::in_root(&temp.join(DROP_ROOT_DIR), slots)?;
    let mut budget = budget_for(stage.path())?;
    let mut declared_bytes_left = budget.remaining_bytes();
    let mut roots = Vec::with_capacity(paths.len());
    for path in paths {
        let source = Path::new(&path);
        if in_temp(source, temp) {
            roots.push(DropRoot::Temporary(PinnedEntry::capture(
                source,
                stage.path(),
                1,
                &mut budget,
                &mut declared_bytes_left,
            )?));
        } else {
            roots.push(DropRoot::Direct(path));
        }
    }
    Ok(PreparedHdrop::Temporary(PinnedDrop {
        stage,
        budget,
        roots,
    }))
}

pub(in crate::platform::windows::dragdrop) struct PinnedDrop {
    stage: DropStage,
    budget: StagingBudget,
    roots: Vec<DropRoot>,
}

impl PinnedDrop {
    pub(in crate::platform::windows::dragdrop) fn materialize(
        mut self,
    ) -> Result<ReceivedFiles, DropDataError> {
        let mut paths = Vec::with_capacity(self.roots.len());
        for root in self.roots {
            paths.push(match root {
                DropRoot::Direct(path) => path,
                DropRoot::Temporary(entry) => entry
                    .write(self.stage.path(), &mut self.budget)?
                    .to_string_lossy()
                    .into_owned(),
            });
        }
        Ok(ReceivedFiles::staged(paths, self.stage))
    }
}

enum DropRoot {
    Direct(String),
    Temporary(PinnedEntry),
}

struct PinnedEntry {
    name: OsString,
    contents: PinnedContents,
}

enum PinnedContents {
    File(File, fs::Metadata),
    Directory(Vec<PinnedEntry>),
}

impl PinnedEntry {
    fn capture(
        path: &Path,
        stage: &Path,
        depth: usize,
        budget: &mut StagingBudget,
        declared_bytes_left: &mut u64,
    ) -> Result<Self, DropDataError> {
        reserve_stage_entry(depth, budget)?;
        let name = path
            .file_name()
            .ok_or(DropDataError::InvalidSource)?
            .to_owned();
        // Keep the directory or file name stable until its children or the
        // delete-sharing file handle have been captured.
        let (_guard, metadata) = open_stage_source(path)?;
        let contents = if metadata.is_dir() {
            if depth == 1 {
                check_stage_directory(path, stage)?;
            }
            let mut children = Vec::new();
            for entry in fs::read_dir(path).map_err(|_| DropDataError::InvalidSource)? {
                let child = entry.map_err(|_| DropDataError::InvalidSource)?.path();
                children.push(Self::capture(
                    &child,
                    stage,
                    depth + 1,
                    budget,
                    declared_bytes_left,
                )?);
            }
            PinnedContents::Directory(children)
        } else {
            *declared_bytes_left = declared_bytes_left
                .checked_sub(metadata.len())
                .ok_or(DropDataError::InsufficientSpace)?;
            let (file, _) =
                open_stage_source_with_sharing(path, FILE_SHARE_READ.0 | FILE_SHARE_DELETE.0)?;
            PinnedContents::File(file, metadata)
        };
        Ok(Self { name, contents })
    }

    fn write(self, parent: &Path, budget: &mut StagingBudget) -> Result<PathBuf, DropDataError> {
        match self.contents {
            PinnedContents::File(file, metadata) => {
                copy_stage_file(&self.name, file, metadata, parent, budget)
            }
            PinnedContents::Directory(children) => {
                let (directory, ()) =
                    create_stage_entry(parent, &self.name, |path| fs::create_dir(path))?;
                for child in children {
                    child.write(&directory, budget)?;
                }
                Ok(directory)
            }
        }
    }
}
