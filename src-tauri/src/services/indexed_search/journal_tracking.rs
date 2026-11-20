// Check mounted volumes and replay structural NTFS changes on the catalog writer.
use crate::domain::indexed_search::{IndexedDriveState, IndexedSearchServiceState};

pub(super) const AMBIGUOUS_PATH_MESSAGE: &str =
    "A changed path could not be matched safely to its indexed spelling.";
// Production cannot open the raw volume. Keep the journal probe and replay
// usable in the explicitly opt-in native tests.
pub(super) const JOURNAL_PAUSED: bool = cfg!(all(windows, not(test)));

use super::{
    catalog::JournalCheckpoint,
    journal_batch::JournalBatch,
    reconcile,
    service::IndexedSearchHandle,
    state::IndexedSearchState,
    volume_tracking::{discover_drives, VolumeMount},
    work_queue::WorkQueue,
};

#[cfg(target_os = "windows")]
use super::windows_journal::{self, JournalChanges, JournalSnapshot};

pub(super) fn capture_checkpoint(mount: &VolumeMount) -> Result<JournalCheckpoint, String> {
    #[cfg(target_os = "windows")]
    {
        return windows_journal::snapshot(&mount.guid).map(checkpoint);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = mount;
        Err("NTFS change journal is unavailable.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn checkpoint(snapshot: JournalSnapshot) -> JournalCheckpoint {
    JournalCheckpoint {
        journal_id: snapshot.journal_id,
        next_usn: snapshot.next_usn,
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
            // A failed journal-gap rebuild waits for a request, re-enable, or remount.
            if !failed || state.volumes.verified.contains(key) {
                // Snapshot identity, rather than a journal cursor, decides whether
                // there is already a complete index to check for this mount.
                mounts_to_check.push((mount.clone(), snapshot.journal_checkpoint));
            }
        } else if !failed {
            queue.queue_rebuild(mount.drive_path.clone());
        }
    }
    mounts_to_check
}

fn verify_saved_volumes(
    state: &mut IndexedSearchState,
    queue: &mut WorkQueue,
    checks: &[(VolumeMount, Option<JournalCheckpoint>)],
) -> bool {
    let mut visibility_changed = false;
    for (mount, _) in checks {
        // Preserve explicit refresh work and stronger warnings. A rescan
        // requirement can make a previously saved index unsafe to reuse.
        if matches!(
            state.drive_statuses[&mount.key()].state,
            IndexedDriveState::Error
                | IndexedDriveState::RescanRequired
                | IndexedDriveState::Scanning
        ) || queue.has_queued_rebuild(&mount.drive_path)
        {
            continue;
        }
        if state.mark_saved_volume_verified(mount) {
            queue.queue_drive_count(mount.drive_path.clone());
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
            let mounts_to_check = prepare_volume_checks(&state, &mut queue);
            // Discovery already verified each mounted identity. In saved
            // mode there is no journal work or second mount probe to run.
            let newly_verified =
                JOURNAL_PAUSED && verify_saved_volumes(&mut state, &mut queue, &mounts_to_check);
            if JOURNAL_PAUSED && state.service_status.state == IndexedSearchServiceState::Starting {
                state.update_service_status(IndexedSearchServiceState::Idle, None);
            }
            drop(state);
            if changed || newly_verified {
                self.bump_catalog_revision();
            }
            mounts_to_check
        };

        if JOURNAL_PAUSED {
            return;
        }
        for (mount, previous) in mounts_to_check {
            if self.should_cancel_work(generation) {
                return;
            }
            self.check_volume_journal(&mount, previous, generation);
        }
    }

    pub(super) fn continue_volume_journal(&self, drive: &str, generation: u64) {
        // Other writer work or a remount may have superseded the queued
        // continuation. Always resume from the current volume's last commit.
        let (mount, previous) = {
            let state = self.inner.state.lock().expect("indexed search state lock");
            let Some(mount) = state.volumes.active_mount(drive) else {
                return;
            };
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
        let Some(previous) = previous else {
            // Starting at the current end would skip all changes since an
            // untracked scan. Establish a new baseline with a complete rebuild.
            match capture_checkpoint(mount) {
                Ok(_) => self.require_volume_rebuild(
                    mount,
                    generation,
                    "Establishing a change journal baseline.",
                ),
                Err(error) => self.report_journal_unavailable(mount, generation, &error),
            }
            return;
        };

        #[cfg(target_os = "windows")]
        match windows_journal::read_changes(&mount.drive_path, &mount.guid, previous, &|| {
            self.should_cancel_work(generation)
        }) {
            Ok(JournalChanges::Batch(batch)) => {
                self.apply_journal_changes(mount, batch, generation)
            }
            Ok(JournalChanges::NeedsRebuild) => {
                self.require_volume_rebuild(
                    mount,
                    generation,
                    "The saved change journal history cannot be replayed.",
                );
            }
            Ok(JournalChanges::Cancelled) => {}
            Err(error) => self.report_journal_unavailable(mount, generation, &error),
        }
        #[cfg(not(target_os = "windows"))]
        let _ = previous;
    }

    #[cfg(target_os = "windows")]
    fn apply_journal_changes(&self, mount: &VolumeMount, batch: JournalBatch, generation: u64) {
        let catalog = self.catalog().expect("journal tracking has a catalog");
        let next = batch.next;
        let has_more = batch.has_more;
        if !batch.changes.is_empty() {
            self.set_service_state(
                IndexedSearchServiceState::Scanning,
                Some(format!("Applying changes on {}", mount.drive_path)),
            );
        }
        let pending_renames = match reconcile::reconcile_journal_batch(
            catalog,
            mount,
            batch,
            &|| self.should_cancel_work(generation),
            &|| mount.verify(),
        ) {
            Ok(reconcile::ReconcileOutcome::Committed {
                changed_paths,
                pending_renames,
            }) => {
                if changed_paths {
                    self.bump_catalog_revision();
                }
                // Persisted checkpoint and in-memory cursor still need to
                // agree if enable/disable happened just after COMMIT.
                let mut state = self.inner.state.lock().expect("indexed search state lock");
                if let Some(snapshot) = state.volumes.snapshots.get_mut(&mount.key()) {
                    if snapshot.volume_id.as_deref() == Some(&mount.identity) {
                        snapshot.journal_checkpoint = Some(next);
                        snapshot.pending_renames = pending_renames;
                    }
                }
                pending_renames
            }
            Ok(reconcile::ReconcileOutcome::Unchanged) => {
                // No catalog transaction ran. Its checkpoint and pending
                // renames still match the snapshot loaded or last committed.
                let state = self.inner.state.lock().expect("indexed search state lock");
                let Some(snapshot) = state.volumes.matching_snapshot(mount) else {
                    return;
                };
                snapshot.pending_renames
            }
            Ok(reconcile::ReconcileOutcome::Cancelled) => return,
            Ok(reconcile::ReconcileOutcome::NeedsRebuild) => {
                self.require_volume_rebuild(mount, generation, AMBIGUOUS_PATH_MESSAGE);
                return;
            }
            Err(error) => {
                self.require_volume_rebuild(mount, generation, &error);
                return;
            }
        };
        if !has_more && !pending_renames {
            self.verify_journal_snapshot(mount, None, generation);
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
        if state.volumes.mounted.get(&key) != Some(mount) {
            return;
        }
        let message = if has_more {
            queue.queue_journal_continuation(mount.drive_path.clone());
            "Catching up on change journal records."
        } else {
            // The captured journal may end between two rename records. The
            // ordinary volume poll will pick up its destination when it arrives.
            "Waiting for a rename to finish in the change journal."
        };
        let status = &state.drive_statuses[&key];
        if status.state != IndexedDriveState::Stale || status.message.as_deref() != Some(message) {
            state.transition_drive_state(
                &mount.drive_path,
                IndexedDriveState::Stale,
                Some(message.into()),
            );
        }
    }

    fn verify_journal_snapshot(
        &self,
        mount: &VolumeMount,
        warning: Option<String>,
        generation: u64,
    ) {
        if mount.verify().is_err() {
            self.require_volume_rebuild(
                mount,
                generation,
                "The volume changed while checking its journal.",
            );
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
        if warning.is_none() && state.volumes.mounted.get(&mount.key()) == Some(mount) {
            state.volumes.journal_rebuilds.remove(&mount.key());
        }
        let changed = state.mark_volume_verified(mount, warning);
        drop(state);
        if changed {
            queue.queue_drive_count(mount.drive_path.clone());
            self.bump_catalog_revision();
        }
    }

    fn report_journal_unavailable(&self, mount: &VolumeMount, generation: u64, error: &str) {
        // A complete snapshot for this same physical volume remains useful,
        // with an explicit stale status until Windows permits journal access.
        self.verify_journal_snapshot(
            mount,
            Some(format!(
                "Change journal unavailable. Showing the last complete index. {error}"
            )),
            generation,
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
        if state.volumes.mounted.get(&mount.key()) != Some(mount) {
            return;
        }
        let changed = state.volumes.verified.remove(&mount.key());
        if state.drive_statuses[&mount.key()].state != IndexedDriveState::Error {
            let status = &state.drive_statuses[&mount.key()];
            if status.state != IndexedDriveState::RescanRequired
                || status.message.as_deref() != Some(message)
            {
                state.transition_drive_state(
                    &mount.drive_path,
                    IndexedDriveState::RescanRequired,
                    Some(message.to_string()),
                );
            }
            // A busy volume can outrun a full scan. Give each recovery one
            // automatic attempt until journal replay succeeds or it remounts.
            if state.volumes.journal_rebuilds.insert(mount.key()) {
                queue.queue_rebuild(mount.drive_path.clone());
            }
        }
        drop(state);
        if changed {
            self.bump_catalog_revision();
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
        assert!(verify_saved_volumes(&mut state, &mut queue, &checks));
        assert!(!verify_saved_volumes(&mut state, &mut queue, &checks));
        let saved = &state.drive_statuses[&mount.key()];
        assert!(saved.state == IndexedDriveState::Saved);
        assert_eq!(state.volumes.verified_mounts(), [mount]);
        assert_eq!(saved.entry_count, Some(25));
        assert_eq!(queue.next(), Some(Work::Rebuild(r"D:\".into())));
        assert_eq!(queue.next(), Some(Work::Rebuild(r"E:\".into())));
        assert_eq!(queue.next(), Some(Work::RefreshDriveCount(r"C:\".into())));
        assert!(queue.is_empty());
    }

    #[test]
    fn routine_saved_verification_leaves_explicit_refresh_and_rescan_states_in_place() {
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
        assert!(verify_saved_volumes(&mut state, &mut queue, &checks));

        assert!(queue.queue_rebuild(drive.into()));
        state.transition_drive_state(drive, IndexedDriveState::Queued, None);
        assert!(!verify_saved_volumes(&mut state, &mut queue, &checks));
        assert!(state.drive_statuses[&key].state == IndexedDriveState::Queued);
        assert!(state.volumes.verified.contains(&key));
        assert_eq!(queue.next(), Some(Work::Rebuild(drive.into())));

        state.volumes.verified.remove(&key);
        state.transition_drive_state(
            drive,
            IndexedDriveState::RescanRequired,
            Some("Changed paths".into()),
        );
        assert!(!verify_saved_volumes(&mut state, &mut queue, &checks));
        assert!(state.drive_statuses[&key].state == IndexedDriveState::RescanRequired);
        assert!(!state.volumes.verified.contains(&key));
    }
}
