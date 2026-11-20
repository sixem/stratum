// Mounted volume identities and the last complete snapshot for each drive.
use std::collections::{BTreeMap, BTreeSet};

use crate::domain::indexed_search::IndexedDriveState;

use super::{
    catalog::DriveCatalogSnapshot,
    state::{normalize_drive_key, IndexedSearchState},
};

#[cfg(target_os = "windows")]
pub(super) use super::windows::{discover_drive, discover_drives, DiscoveredDrive};

#[cfg(not(target_os = "windows"))]
pub(super) struct DiscoveredDrive {
    pub(super) status: crate::domain::indexed_search::IndexedDriveStatus,
    pub(super) volume_identity: Option<String>,
    pub(super) volume_guid: Option<String>,
}

#[cfg(not(target_os = "windows"))]
pub(super) fn discover_drives() -> Result<Vec<DiscoveredDrive>, String> {
    Ok(Vec::new())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct VolumeMount {
    pub(super) drive_path: String,
    pub(super) identity: String,
    pub(super) guid: String,
}

impl VolumeMount {
    fn from_discovery(drive: &DiscoveredDrive) -> Option<Self> {
        Some(Self {
            drive_path: drive.status.drive_path.clone(),
            identity: drive.volume_identity.clone()?,
            guid: drive.volume_guid.clone()?,
        })
    }

    pub(super) fn key(&self) -> String {
        normalize_drive_key(&self.drive_path)
    }

    pub(super) fn verify(&self) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        if Self::from_discovery(&discover_drive(&self.drive_path)).as_ref() == Some(self) {
            return Ok(());
        }
        Err(format!(
            "Volume mounted at {} changed or is unavailable.",
            self.drive_path
        ))
    }
}

#[derive(Default)]
pub(super) struct VolumeTracking {
    pub(super) mounted: BTreeMap<String, VolumeMount>,
    pub(super) snapshots: BTreeMap<String, DriveCatalogSnapshot>,
    // Verification is session state. A durable last snapshot is never enough
    // to establish that its drive letter still belongs to the same volume.
    pub(super) verified: BTreeSet<String>,
    pub(super) journal_rebuilds: BTreeSet<String>,
}

impl VolumeTracking {
    pub(super) fn load_snapshots(&mut self, snapshots: Vec<DriveCatalogSnapshot>) {
        self.snapshots = snapshots
            .into_iter()
            .map(|snapshot| (normalize_drive_key(&snapshot.drive_path), snapshot))
            .collect();
    }

    pub(super) fn matching_snapshot(&self, mount: &VolumeMount) -> Option<&DriveCatalogSnapshot> {
        self.snapshots
            .get(&mount.key())
            .filter(|snapshot| snapshot.volume_id.as_deref() == Some(&mount.identity))
    }

    pub(super) fn active_mount(&self, path: &str) -> Option<VolumeMount> {
        self.mounted.get(&normalize_drive_key(path)).cloned()
    }

    pub(super) fn verified_mounts(&self) -> Vec<VolumeMount> {
        self.verified
            .iter()
            .filter_map(|key| self.mounted.get(key).cloned())
            .collect()
    }
}

impl IndexedSearchState {
    pub(super) fn update_mounts(&mut self, drives: Vec<DiscoveredDrive>) -> bool {
        let mut mounted = BTreeMap::new();
        let mut statuses = BTreeMap::new();
        for drive in drives {
            let key = normalize_drive_key(&drive.status.drive_path);
            let mount = VolumeMount::from_discovery(&drive);
            let mut status = drive.status;
            if let Some(mount) = mount {
                if self.volumes.mounted.get(&key) == Some(&mount) {
                    if let Some(existing) = self.drive_statuses.remove(&key) {
                        status = existing;
                    }
                } else if let Some(snapshot) = self.volumes.matching_snapshot(&mount) {
                    status.state = IndexedDriveState::Stale;
                    status.started_at = snapshot.last_scan_completed_at.or(status.started_at);
                    status.entry_count = snapshot.entry_count.map(|count| count as u64);
                    status.source_label = snapshot.last_scan_source.clone();
                    status.message = Some("Checking the saved index.".to_string());
                } else if self.volumes.snapshots.contains_key(&key) {
                    status.state = IndexedDriveState::RescanRequired;
                    status.message =
                        Some("The saved index needs a scan for this volume.".to_string());
                }
                mounted.insert(key.clone(), mount);
            }
            statuses.insert(key, status);
        }

        let previous_mounts = &self.volumes.mounted;
        self.volumes.verified.retain(|key| {
            mounted
                .get(key)
                .is_some_and(|mount| previous_mounts.get(key) == Some(mount))
        });
        self.volumes.journal_rebuilds.retain(|key| {
            mounted
                .get(key)
                .is_some_and(|mount| previous_mounts.get(key) == Some(mount))
        });
        let changed = self.volumes.mounted != mounted;
        self.volumes.mounted = mounted;
        self.drive_statuses = statuses;
        self.update_service_status(
            self.service_status.state,
            self.service_status.activity_label.clone(),
        );
        changed
    }

    pub(super) fn mark_volume_verified(
        &mut self,
        mount: &VolumeMount,
        warning: Option<String>,
    ) -> bool {
        let next_state = if warning.is_some() {
            IndexedDriveState::Stale
        } else {
            IndexedDriveState::Ready
        };
        self.mark_verified_mount(mount, next_state, warning)
    }

    pub(super) fn mark_saved_volume_verified(&mut self, mount: &VolumeMount) -> bool {
        self.mark_verified_mount(
            mount,
            IndexedDriveState::Saved,
            Some("Using the saved index. Stratum updates open folders and file operations. Refresh the index to scan the whole drive.".to_owned()),
        )
    }

    fn mark_verified_mount(
        &mut self,
        mount: &VolumeMount,
        next_state: IndexedDriveState,
        message: Option<String>,
    ) -> bool {
        let key = mount.key();
        if self.volumes.mounted.get(&key) != Some(mount) {
            return false;
        }
        if let Some(status) = self.drive_statuses.get(&key) {
            if status.state != next_state || status.message != message {
                self.transition_drive_state(&mount.drive_path, next_state, message);
            }
        }
        self.volumes.verified.insert(key)
    }
}
