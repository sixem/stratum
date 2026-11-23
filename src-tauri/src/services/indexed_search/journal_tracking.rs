// Verify mounted volumes and maintain the standard user's saved index.
use std::time::Instant;

use crate::domain::indexed_search::{IndexedDriveState, IndexedSearchServiceState};

use super::{
    catalog::JournalCheckpoint,
    service::IndexedSearchHandle,
    state::IndexedSearchState,
    volume_tracking::{discover_drives, VolumeMount},
    work_queue::WorkQueue,
};

#[cfg(windows)]
use super::{
    user_journal_reconcile::{reconcile_user_journal_batch, UserReconcileOutcome},
    windows_user_journal::{self, UserJournalBatch, UserJournalChanges},
};

pub(super) const AMBIGUOUS_PATH_MESSAGE: &str =
    "A changed path could not be matched safely to its indexed spelling.";

pub(super) fn capture_checkpoint(mount: &VolumeMount) -> Result<JournalCheckpoint, String> {
    #[cfg(windows)]
    {
        windows_user_journal::snapshot(&mount.guid).map(|snapshot| JournalCheckpoint {
            journal_id: snapshot.journal_id,
            next_usn: snapshot.next_usn,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = mount;
        Err("NTFS change tracking is unavailable.".to_string())
    }
}

fn prepare_volume_checks(
    state: &IndexedSearchState,
    queue: &mut WorkQueue,
) -> Vec<(VolumeMount, Option<JournalCheckpoint>)> {
    let mut mounts_to_check = Vec::new();
    for (key, mount) in &state.volumes.mounted {
        let failed = state.drive_statuses[key].state == IndexedDriveState::Error;
        if let Some(snapshot) = state.volumes.matching_snapshot(mount) {
            if !failed || state.volumes.verified.contains(key) {
                let checkpoint = snapshot
                    .journal_checkpoint
                    .filter(|_| !snapshot.pending_renames);
                mounts_to_check.push((mount.clone(), checkpoint));
            }
        } else if !failed {
            queue.queue_rebuild(mount.drive_path.clone());
        }
    }
    mounts_to_check
}

fn expose_saved_volumes(
    state: &mut IndexedSearchState,
    queue: &mut WorkQueue,
    checks: &[(VolumeMount, Option<JournalCheckpoint>)],
) -> bool {
    let mut visibility_changed = false;
    for (mount, _) in checks {
        // Discovery matched the volume's identity. Keep its saved results
        // searchable during replay and while an atomic baseline scan runs.
        if state.volumes.verified.insert(mount.key()) {
            if state
                .volumes
                .matching_snapshot(mount)
                .is_some_and(|snapshot| snapshot.entry_count.is_none())
            {
                queue.queue_drive_count(mount.drive_path.clone());
            }
            visibility_changed = true;
        }
    }
    visibility_changed
}

impl IndexedSearchHandle {
    pub(super) fn run_volume_check(&self, generation: u64) {
        let drives = match discover_drives() {
            Ok(drives) => drives,
            Err(error) => {
                eprintln!("[indexed-search] Volume discovery failed: {error}");
                return;
            }
        };
        let mounts_to_check = {
            let mut queue = self
                .inner
                .work_queue
                .lock()
                .expect("indexed search work queue");
            if self.should_cancel_work(generation) {
                return;
            }
            let mut state = self.inner.state.lock().expect("indexed search state lock");
            let changed = state.update_mounts(drives);
            let mut mounts_to_check = prepare_volume_checks(&state, &mut queue);
            let newly_verified = expose_saved_volumes(&mut state, &mut queue, &mounts_to_check);
            mounts_to_check.retain(|(mount, _)| !queue.has_queued_rebuild(&mount.drive_path));
            drop(state);
            if changed || newly_verified {
                self.bump_catalog_revision();
                queue.queue_size_backfill();
            }
            mounts_to_check
        };

        for (mount, previous) in mounts_to_check {
            if self.should_cancel_work(generation) {
                return;
            }
            self.check_volume_journal(&mount, previous, generation);
        }
    }

    pub(super) fn continue_volume_journal(&self, drive: &str, generation: u64) {
        let (mount, previous) = {
            let state = self.inner.state.lock().expect("indexed search state lock");
            let Some(mount) = state.volumes.active_mount(drive) else {
                return;
            };
            if !state.has_verified_journal(&mount.key()) {
                return;
            }
            let Some(snapshot) = state.volumes.matching_snapshot(&mount) else {
                return;
            };
            (mount, snapshot.journal_checkpoint)
        };
        self.check_volume_journal(&mount, previous, generation);
    }

    fn check_volume_journal(
        &self,
        mount: &VolumeMount,
        previous: Option<JournalCheckpoint>,
        generation: u64,
    ) {
        self.inner
            .work_queue
            .lock()
            .expect("indexed search work queue")
            .note_journal_check(&mount.drive_path, Instant::now());
        let Some(previous) = previous else {
            // Jumping to the current cursor would miss changes made between
            // the saved scan and this launch. Capture a cursor before rescanning.
            match capture_checkpoint(mount) {
                Ok(_) => self.require_volume_rebuild(
                    mount,
                    generation,
                    "Establishing change tracking. Saved results stay available.",
                ),
                Err(error) => self.report_journal_unavailable(mount, generation, &error, false),
            }
            return;
        };

        #[cfg(windows)]
        match windows_user_journal::read_changes(&mount.guid, previous, &|| {
            self.should_cancel_work(generation)
        }) {
            Ok(UserJournalChanges::Batch(batch)) => {
                self.apply_journal_changes(mount, batch, generation)
            }
            Ok(UserJournalChanges::NeedsRebuild) => self.require_volume_rebuild(
                mount,
                generation,
                "Change history is incomplete. The index needs a new baseline.",
            ),
            Ok(UserJournalChanges::Cancelled) => {}
            Err(error) => self.report_journal_unavailable(mount, generation, &error, true),
        }
        #[cfg(not(windows))]
        let _ = previous;
    }

    #[cfg(windows)]
    fn apply_journal_changes(&self, mount: &VolumeMount, batch: UserJournalBatch, generation: u64) {
        let catalog = self.catalog().expect("journal tracking has a catalog");
        let next = batch.next;
        let has_more = batch.has_more;
        if !batch.changes.is_empty() {
            self.set_service_state(
                IndexedSearchServiceState::Scanning,
                Some(format!("Applying changes on {}", mount.drive_path)),
            );
        }
        match reconcile_user_journal_batch(catalog, mount, batch, &|| {
            self.should_cancel_work(generation)
        }) {
            Ok(UserReconcileOutcome::Committed {
                changed_paths,
                entry_count,
            }) => {
                // Update the in-memory cursor even if enable/disable happened
                // just after the catalog transaction committed.
                let mut state = self.inner.state.lock().expect("indexed search state lock");
                if let Some(snapshot) = state.volumes.snapshots.get_mut(&mount.key()) {
                    if snapshot.volume_id.as_deref() == Some(&mount.identity) {
                        snapshot.journal_checkpoint = Some(next);
                        snapshot.pending_renames = false;
                        if let Some(count) = entry_count {
                            snapshot.entry_count = Some(count);
                            let source = snapshot.last_scan_source.clone();
                            state.set_drive_summary(&mount.drive_path, Some(count as u64), source);
                        }
                    }
                }
                if changed_paths {
                    self.bump_catalog_revision();
                }
            }
            Ok(UserReconcileOutcome::Unchanged) => {}
            Ok(UserReconcileOutcome::Cancelled) => return,
            Err(error) => {
                self.report_journal_unavailable(mount, generation, &error, true);
                return;
            }
        }
        if !has_more {
            self.finish_journal_check(mount, generation, None, true);
            return;
        }

        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.should_cancel_work(generation) {
            return;
        }
        let mut state = self.inner.state.lock().expect("indexed search state lock");
        let key = mount.key();
        if state.volumes.mounted.get(&key) != Some(mount)
            || queue.has_queued_rebuild(&mount.drive_path)
        {
            return;
        }
        queue.queue_journal_continuation(mount.drive_path.clone());
        let message = "Catching up on change journal records.";
        let status = &state.drive_statuses[&key];
        if status.state != IndexedDriveState::Stale || status.message.as_deref() != Some(message) {
            state.transition_drive_state(
                &mount.drive_path,
                IndexedDriveState::Stale,
                Some(message.into()),
            );
        }
    }

    fn finish_journal_check(
        &self,
        mount: &VolumeMount,
        generation: u64,
        warning: Option<String>,
        has_checkpoint: bool,
    ) {
        let still_mounted = mount.verify().is_ok();
        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.should_cancel_work(generation) {
            return;
        }
        let mut state = self.inner.state.lock().expect("indexed search state lock");
        let key = mount.key();
        if state.volumes.mounted.get(&key) != Some(mount) {
            return;
        }
        if !still_mounted {
            if state.volumes.verified.remove(&key) {
                self.bump_catalog_revision();
            }
            queue.queue_volume_check();
            return;
        }
        if queue.has_queued_rebuild(&mount.drive_path) {
            return;
        }
        if warning.is_none() {
            state.volumes.journal_rebuilds.remove(&key);
            state.volumes.unavailable_journals.remove(&key);
        } else {
            state.volumes.unavailable_journals.insert(key);
        }
        let changed = if has_checkpoint {
            state.mark_volume_verified(mount, warning)
        } else {
            state.mark_saved_volume_verified(mount, warning)
        };
        if changed {
            self.bump_catalog_revision();
        }
    }

    fn report_journal_unavailable(
        &self,
        mount: &VolumeMount,
        generation: u64,
        error: &str,
        has_checkpoint: bool,
    ) {
        self.finish_journal_check(
            mount,
            generation,
            Some(format!(
                "Live updates unavailable. Showing saved results. {error}"
            )),
            has_checkpoint,
        );
    }

    pub(super) fn require_volume_rebuild(
        &self,
        mount: &VolumeMount,
        generation: u64,
        message: &str,
    ) {
        let mut queue = self
            .inner
            .work_queue
            .lock()
            .expect("indexed search work queue");
        if self.should_cancel_work(generation) {
            return;
        }
        let mut state = self.inner.state.lock().expect("indexed search state lock");
        let key = mount.key();
        if state.volumes.mounted.get(&key) != Some(mount)
            || queue.has_queued_rebuild(&mount.drive_path)
        {
            return;
        }
        let status = &state.drive_statuses[&key];
        if status.state == IndexedDriveState::Error {
            return;
        }
        if status.state != IndexedDriveState::RescanRequired
            || status.message.as_deref() != Some(message)
        {
            state.transition_drive_state(
                &mount.drive_path,
                IndexedDriveState::RescanRequired,
                Some(message.into()),
            );
        }
        // Try one automatic rebuild for this gap. If the drive outruns that
        // scan as well, leave it searchable and wait for a manual refresh.
        if state.volumes.journal_rebuilds.insert(key) {
            queue.queue_rebuild(mount.drive_path.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::indexed_search::IndexedDriveStatus;
    use crate::services::indexed_search::{
        catalog::DriveCatalogSnapshot, volume_tracking::DiscoveredDrive, work_queue::Work,
    };

    fn discovered_drive(root: &str, identity: &str) -> DiscoveredDrive {
        DiscoveredDrive {
            status: IndexedDriveStatus {
                drive_path: root.into(),
                filesystem: Some("NTFS".into()),
                state: IndexedDriveState::Queued,
                indexable: true,
                searchable: false,
                started_at: None,
                last_updated_at: 0,
                entry_count: None,
                source_label: None,
                message: None,
            },
            volume_identity: Some(identity.into()),
            volume_guid: Some(format!(r"\\?\Volume{{{identity}}}\")),
        }
    }

    fn saved_snapshot(root: &str, identity: &str) -> DriveCatalogSnapshot {
        DriveCatalogSnapshot {
            drive_path: root.into(),
            volume_id: Some(identity.into()),
            journal_checkpoint: None,
            pending_renames: false,
            entry_count: Some(25),
            last_scan_source: Some("Filesystem scan".into()),
            last_scan_completed_at: Some(1),
        }
    }

    #[test]
    fn startup_checks_the_matching_index_and_only_scans_missing_or_changed_volumes() {
        let mut state = IndexedSearchState::new();
        state.volumes.load_snapshots(vec![
            saved_snapshot(r"C:\", "saved-system"),
            saved_snapshot(r"E:\", "old-removable"),
        ]);
        state.update_mounts(vec![
            discovered_drive(r"C:\", "saved-system"),
            discovered_drive(r"D:\", "new-data"),
            discovered_drive(r"E:\", "new-removable"),
        ]);

        let mut queue = WorkQueue::default();
        let checks = prepare_volume_checks(&state, &mut queue);
        let mount = state.volumes.active_mount(r"C:\").unwrap();
        let saved = &state.drive_statuses[&mount.key()];
        assert_eq!(checks, vec![(mount.clone(), None)]);
        assert!(saved.state == IndexedDriveState::Stale);
        assert_eq!(saved.entry_count, Some(25));
        assert_eq!(saved.message.as_deref(), Some("Checking the saved index."));
        assert!(!state
            .drive_statuses_snapshot(true)
            .iter()
            .any(|drive| drive.searchable));
        assert!(expose_saved_volumes(&mut state, &mut queue, &checks));
        assert!(!expose_saved_volumes(&mut state, &mut queue, &checks));
        let saved = &state.drive_statuses[&mount.key()];
        assert!(saved.state == IndexedDriveState::Stale);
        assert_eq!(state.volumes.verified_mounts(), [mount]);
        let searchable = state
            .drive_statuses_snapshot(true)
            .into_iter()
            .filter(|drive| drive.searchable)
            .map(|drive| drive.drive_path)
            .collect::<Vec<_>>();
        assert_eq!(searchable, [r"C:\"]);
        assert!(!state
            .drive_statuses_snapshot(false)
            .iter()
            .any(|drive| drive.searchable));
        assert_eq!(saved.entry_count, Some(25));
        assert_eq!(queue.next(), Some(Work::Rebuild(r"D:\".into())));
        assert_eq!(queue.next(), Some(Work::Rebuild(r"E:\".into())));
        assert!(queue.is_empty());
    }

    #[test]
    fn saved_results_remain_searchable_during_refresh_and_rescan() {
        let mut state = IndexedSearchState::new();
        let drive = r"C:\";
        state
            .volumes
            .load_snapshots(vec![saved_snapshot(drive, "saved")]);
        state.update_mounts(vec![discovered_drive(drive, "saved")]);
        let mount = state.volumes.active_mount(drive).unwrap();
        let key = mount.key();
        let mut queue = WorkQueue::default();
        let checks = prepare_volume_checks(&state, &mut queue);
        assert!(expose_saved_volumes(&mut state, &mut queue, &checks));

        assert!(queue.queue_rebuild(drive.into()));
        state.transition_drive_state(drive, IndexedDriveState::Queued, None);
        assert!(!expose_saved_volumes(&mut state, &mut queue, &checks));
        assert!(state.drive_statuses[&key].state == IndexedDriveState::Queued);
        assert!(state.volumes.verified.contains(&key));
        assert_eq!(queue.next(), Some(Work::Rebuild(drive.into())));

        state.transition_drive_state(
            drive,
            IndexedDriveState::RescanRequired,
            Some("Changed paths".into()),
        );
        assert!(!expose_saved_volumes(&mut state, &mut queue, &checks));
        assert!(state.drive_statuses[&key].state == IndexedDriveState::RescanRequired);
        assert!(state.volumes.verified.contains(&key));
    }
}
