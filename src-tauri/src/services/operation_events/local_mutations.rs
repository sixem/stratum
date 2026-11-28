// User-facing local mutations that complete outside the transfer queue.
use super::{DeleteMethod, EntryKind, ItemSuccess, Location, OperationEvents, Origin};
use crate::domain::filesystem as fs;
use std::path::Path;

impl OperationEvents {
    pub(crate) fn create_entry(&self, path: String, kind: EntryKind) -> Result<(), String> {
        let target = Path::new(path.trim()).to_owned();
        match kind {
            EntryKind::File => fs::create_file(path)?,
            EntryKind::Directory => fs::create_folder(path)?,
        }
        self.local_item(None, &target, kind, || ItemSuccess::Created {
            destination: Location::Local(target.clone()),
        });
        Ok(())
    }

    pub(crate) fn create_tracked_folder(
        &self,
        parent: String,
        name: String,
    ) -> Result<fs::CreatedFolder, String> {
        let folder = fs::create_tracked_folder(parent, name)?;
        self.local_item(None, Path::new(&folder.path), EntryKind::Directory, || {
            ItemSuccess::Created {
                destination: Location::Local((&folder.path).into()),
            }
        });
        Ok(folder)
    }

    pub(crate) fn remove_created_folder(&self, folder: fs::CreatedFolder) -> Result<bool, String> {
        let path = folder.path.clone();
        let removed = fs::remove_created_folder_if_empty(folder)?;
        if removed {
            self.local_item(None, Path::new(&path), EntryKind::Directory, || {
                ItemSuccess::Deleted(DeleteMethod::Permanent)
            });
        }
        Ok(removed)
    }

    pub(crate) fn rename(
        &self,
        id: Option<&str>,
        path: String,
        name: String,
        identity: Option<fs::EntryIdentity>,
    ) -> Result<fs::RenamedEntry, String> {
        let renamed = fs::rename_entry(path.clone(), name, identity)?;
        self.local_item(id, Path::new(&path), renamed.kind, || {
            ItemSuccess::Relocated {
                destination: Location::Local((&renamed.path).into()),
            }
        });
        Ok(renamed)
    }

    pub(crate) fn restore_recycle_items(
        &self,
        receipt: String,
    ) -> Result<fs::RestoreRecycleReport, String> {
        let restored = fs::restore_recycle_items(receipt)?;
        if self.has_subscribers() {
            let mut op = self.operation(
                None,
                Origin::User,
                restored
                    .restored_roots
                    .iter()
                    .map(|(source, _, _)| Location::Local(source.clone())),
            );
            for (source, destination, kind) in &restored.restored_roots {
                op.item_succeeded(&Location::Local(source.clone()), *kind, || {
                    ItemSuccess::Relocated {
                        destination: Location::Local(destination.clone()),
                    }
                });
            }
        }
        Ok(restored)
    }
}
