// Summarize the outputs a job actually published for the Recent Jobs action.
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferDestination {
    pub folder_path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_path: Option<PathBuf>,
}

#[derive(Clone, Default)]
pub(crate) enum DestinationSummary {
    #[default]
    Empty,
    OneFolder(TransferDestination),
    MultipleFolders,
}

impl DestinationSummary {
    pub(crate) fn record_output(&mut self, output: &Path) {
        let Some(folder) = output.parent().filter(|folder| folder.is_absolute()) else {
            return;
        };

        match self {
            Self::Empty => {
                *self = Self::OneFolder(TransferDestination {
                    folder_path: folder.to_owned(),
                    entry_path: Some(output.to_owned()),
                });
            }
            Self::OneFolder(destination) if destination.folder_path == folder => {
                if destination.entry_path.as_deref() != Some(output) {
                    destination.entry_path = None;
                }
            }
            Self::OneFolder(_) => *self = Self::MultipleFolders,
            Self::MultipleFolders => {}
        }
    }

    pub(crate) fn target(&self) -> Option<TransferDestination> {
        match self {
            Self::OneFolder(destination) => Some(destination.clone()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_a_lone_output_and_opens_a_shared_folder_for_multiple_outputs() {
        let root = std::env::temp_dir();
        let first = root.join("first.png");
        let mut destination = DestinationSummary::default();
        assert!(destination.target().is_none());

        destination.record_output(&first);
        let target = destination.target().unwrap();
        assert_eq!(target.folder_path, root);
        assert_eq!(target.entry_path.as_deref(), Some(first.as_path()));

        destination.record_output(&root.join("second.png"));
        let target = destination.target().unwrap();
        assert_eq!(target.folder_path, root);
        assert!(target.entry_path.is_none());
    }

    #[test]
    fn a_job_with_outputs_in_separate_directories_has_no_single_destination() {
        let root = std::env::temp_dir();
        let mut destination = DestinationSummary::default();
        destination.record_output(&root.join("first.png"));
        destination.record_output(&root.join("other").join("second.png"));
        destination.record_output(&root.join("third.png"));
        assert!(destination.target().is_none());
    }
}
