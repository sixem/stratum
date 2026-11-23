use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::domain::indexed_search::{
    IndexedDriveState, IndexedDriveStatus, IndexedSearchServiceState, IndexedSearchServiceStatus,
};

use super::volume_tracking::VolumeTracking;

pub(super) struct IndexedSearchState {
    pub(super) service_status: IndexedSearchServiceStatus,
    pub(super) drive_statuses: BTreeMap<String, IndexedDriveStatus>,
    pub(super) volumes: VolumeTracking,
}

impl IndexedSearchState {
    pub(super) fn new() -> Self {
        let now = now_epoch_ms();
        Self {
            service_status: IndexedSearchServiceStatus {
                state: IndexedSearchServiceState::Starting,
                catalog_revision: 0,
                activity_label: None,
                started_at: now,
                last_updated_at: now,
                drive_count: 0,
                indexable_drive_count: 0,
                searchable_drive_count: 0,
            },
            drive_statuses: BTreeMap::new(),
            volumes: VolumeTracking::default(),
        }
    }

    pub(super) fn drive_statuses_snapshot(&self, enabled: bool) -> Vec<IndexedDriveStatus> {
        self.drive_statuses
            .iter()
            .map(|(key, status)| IndexedDriveStatus {
                searchable: enabled && self.volumes.verified.contains(key),
                ..status.clone()
            })
            .collect()
    }

    pub(super) fn update_service_status(
        &mut self,
        state: IndexedSearchServiceState,
        activity_label: Option<String>,
    ) {
        let now = now_epoch_ms();
        self.service_status = IndexedSearchServiceStatus {
            state,
            catalog_revision: self.service_status.catalog_revision,
            activity_label,
            started_at: self.service_status.started_at,
            last_updated_at: now,
            drive_count: self.drive_statuses.len(),
            indexable_drive_count: self
                .drive_statuses
                .values()
                .filter(|status| status.indexable)
                .count(),
            // Filled from the verified mounts when status is requested.
            searchable_drive_count: 0,
        };
    }

    pub(super) fn transition_drive_state(
        &mut self,
        drive_path: &str,
        next_state: IndexedDriveState,
        message: Option<String>,
    ) {
        let now = now_epoch_ms();
        let key = normalize_drive_key(drive_path);
        let Some(status) = self.drive_statuses.get_mut(&key) else {
            return;
        };

        if status.state != next_state {
            status.state = next_state;
            status.started_at = Some(now);
        } else if status.started_at.is_none() {
            status.started_at = Some(now);
        }

        status.last_updated_at = now;
        status.message = message;
        self.service_status.last_updated_at = now;
    }

    pub(super) fn mark_indexable_drives_error(&mut self, message: &str) {
        let now = now_epoch_ms();
        for status in self.drive_statuses.values_mut() {
            if !status.indexable {
                continue;
            }

            if status.state != IndexedDriveState::Error {
                status.state = IndexedDriveState::Error;
                status.started_at = Some(now);
            } else if status.started_at.is_none() {
                status.started_at = Some(now);
            }

            status.last_updated_at = now;
            status.message = Some(message.to_string());
        }

        self.service_status.last_updated_at = now;
    }

    pub(super) fn set_drive_summary(
        &mut self,
        drive_path: &str,
        entry_count: Option<u64>,
        source_label: Option<String>,
    ) {
        let now = now_epoch_ms();
        let key = normalize_drive_key(drive_path);
        let Some(status) = self.drive_statuses.get_mut(&key) else {
            return;
        };

        status.entry_count = entry_count;
        status.source_label = source_label;
        status.last_updated_at = now;
        self.service_status.last_updated_at = now;
    }

    pub(super) fn touch_drive(&mut self, drive_path: &str) {
        let now = now_epoch_ms();
        let key = normalize_drive_key(drive_path);
        let Some(status) = self.drive_statuses.get_mut(&key) else {
            return;
        };

        status.last_updated_at = now;
        self.service_status.last_updated_at = now;
    }
}

pub(super) fn normalize_drive_key(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches(['\\', '/']);
    trimmed.to_ascii_lowercase()
}

pub(super) fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
