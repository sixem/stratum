// Keep an offered stage with its WebView until a native transfer takes ownership.
use super::{stage_slots::StageSlots, staging::DropStage};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

pub(crate) fn staged_path_spelling_supported(path: &str) -> bool {
    // The transfer planners trim path strings. Reject the union of Rust and
    // JavaScript whitespace so an offered path cannot turn into a sibling.
    path == path
        .trim_matches(|character: char| character.is_whitespace() || character == '\u{feff}')
}

#[derive(Default)]
pub struct IncomingDrops {
    pub(super) staging_slots: StageSlots,
    state: Mutex<DropRegistry>,
}

#[derive(Default)]
struct DropRegistry {
    next_generation: u64,
    next_stage: u64,
    receivers: HashMap<String, DropReceiver>,
}

struct DropReceiver {
    generation: u64,
    pending: HashMap<u64, PendingStage>,
}

struct PendingStage {
    stage: DropStage,
    sources: HashSet<String>,
}

impl IncomingDrops {
    pub fn subscribe(&self, label: &str) {
        let mut state = self.state.lock().expect("drop registry poisoned");
        if state.receivers.contains_key(label) {
            return;
        }
        state.next_generation += 1;
        let generation = state.next_generation;
        state.receivers.insert(
            label.to_owned(),
            DropReceiver {
                generation,
                pending: HashMap::new(),
            },
        );
    }

    pub fn unsubscribe(&self, label: &str) {
        if let Some(receiver) = self.detach_receiver(label) {
            if !receiver.pending.is_empty() {
                // A page-load callback can run on the UI thread. Deletion does
                // not need to hold the registry lock or block the next page.
                drop(tauri::async_runtime::spawn_blocking(move || drop(receiver)));
            }
        }
    }

    fn detach_receiver(&self, label: &str) -> Option<DropReceiver> {
        self.state
            .lock()
            .expect("drop registry poisoned")
            .receivers
            .remove(label)
    }

    pub(super) fn generation(&self, label: &str) -> Option<u64> {
        self.state
            .lock()
            .expect("drop registry poisoned")
            .receivers
            .get(label)
            .map(|receiver| receiver.generation)
    }

    pub(super) fn retain(
        &self,
        label: &str,
        generation: u64,
        stage: DropStage,
        paths: &[String],
    ) -> Option<u64> {
        let sources = paths.iter().cloned().collect();
        let mut state = self.state.lock().expect("drop registry poisoned");
        state.next_stage += 1;
        let id = state.next_stage;
        let receiver = state
            .receivers
            .get_mut(label)
            .filter(|receiver| receiver.generation == generation)?;
        receiver.pending.insert(id, PendingStage { stage, sources });
        Some(id)
    }

    pub(crate) fn take_for_transfer(
        &self,
        label: &str,
        id: u64,
        paths: &[String],
    ) -> Result<DropStage, String> {
        let unavailable = || "The dropped files are no longer available. Drop them again.";
        let mut state = self.state.lock().expect("drop registry poisoned");
        let receiver = state.receivers.get_mut(label).ok_or_else(unavailable)?;
        let stage = receiver.pending.get(&id).ok_or_else(unavailable)?;
        // The conflict UI can skip part of a drop. Every remaining root must
        // still be one of the original paths offered by the native source.
        if paths.is_empty()
            || !paths
                .iter()
                .all(|path| stage.sources.contains(path) && staged_path_spelling_supported(path))
        {
            return Err("The transfer does not match the dropped file selection.".into());
        }
        let pending = receiver.pending.remove(&id).ok_or_else(unavailable)?;
        Ok(pending.stage)
    }

    pub fn release(&self, label: &str, id: u64) {
        let pending = self
            .state
            .lock()
            .expect("drop registry poisoned")
            .receivers
            .get_mut(label)
            .and_then(|receiver| receiver.pending.remove(&id));
        drop(pending);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::{fs, path::Path};

    fn staged_file(drops: &IncomingDrops) -> (DropStage, String) {
        let stage = DropStage::new(&drops.staging_slots).unwrap();
        let path = stage.path().join("sample.txt");
        fs::write(&path, "sample").unwrap();
        (stage, path.to_str().unwrap().to_owned())
    }

    pub(crate) fn claimed_test_file() -> (DropStage, String) {
        let drops = IncomingDrops::default();
        drops.subscribe("main");
        let generation = drops.generation("main").unwrap();
        let (stage, source) = staged_file(&drops);
        let sources = std::slice::from_ref(&source);
        let id = drops.retain("main", generation, stage, sources).unwrap();
        (
            drops.take_for_transfer("main", id, sources).unwrap(),
            source,
        )
    }

    #[test]
    fn staged_paths_reject_names_trimmed_by_either_planner() {
        let source = r"C:\source\example";
        assert!(staged_path_spelling_supported(source));
        assert!(staged_path_spelling_supported(
            r"C:\folder with spaces\ leading.txt"
        ));
        for whitespace in [' ', '\u{85}', '\u{a0}', '\u{feff}'] {
            assert!(!staged_path_spelling_supported(&format!(
                "{source}{whitespace}"
            )));
        }
    }

    #[test]
    fn the_owner_can_transfer_a_subset_once_and_other_receivers_cannot_release_it() {
        let drops = IncomingDrops::default();
        drops.subscribe("main");
        drops.subscribe("other");
        let generation = drops.generation("main").unwrap();
        let (stage, source) = staged_file(&drops);
        let unrelated = String::from(r"C:\unrelated.txt");
        let id = drops
            .retain(
                "main",
                generation,
                stage,
                &[source.clone(), String::from(r"C:\also-selected.txt")],
            )
            .unwrap();

        drops.release("other", id);
        assert!(drops
            .take_for_transfer("other", id, std::slice::from_ref(&source))
            .is_err());
        assert!(drops.take_for_transfer("main", id, &[unrelated]).is_err());
        let stage = drops
            .take_for_transfer("main", id, std::slice::from_ref(&source))
            .unwrap();
        assert!(drops
            .take_for_transfer("main", id, std::slice::from_ref(&source))
            .is_err());
        drops.release("main", id);
        assert!(Path::new(&source).exists());
        drop(stage);
        assert!(!Path::new(&source).exists());
    }

    #[test]
    fn page_teardown_cleans_pending_files_but_cannot_touch_a_native_transfer() {
        let drops = IncomingDrops::default();
        drops.subscribe("main");
        let generation = drops.generation("main").unwrap();
        let (stage, pending_path) = staged_file(&drops);
        let pending_id = drops
            .retain(
                "main",
                generation,
                stage,
                std::slice::from_ref(&pending_path),
            )
            .unwrap();
        let (stage, transfer_path) = staged_file(&drops);
        let transfer_id = drops
            .retain(
                "main",
                generation,
                stage,
                std::slice::from_ref(&transfer_path),
            )
            .unwrap();
        let transfer = drops
            .take_for_transfer("main", transfer_id, std::slice::from_ref(&transfer_path))
            .unwrap();

        drop(drops.detach_receiver("main"));
        drops.subscribe("main");
        assert!(!Path::new(&pending_path).exists());
        assert!(drops
            .take_for_transfer("main", pending_id, std::slice::from_ref(&pending_path))
            .is_err());
        let (late_stage, late_path) = staged_file(&drops);
        assert!(drops
            .retain(
                "main",
                generation,
                late_stage,
                std::slice::from_ref(&late_path)
            )
            .is_none());
        assert!(!Path::new(&late_path).exists());
        assert_eq!(fs::read(&transfer_path).unwrap(), b"sample");
        drop(transfer);
        assert!(!Path::new(&transfer_path).exists());
    }
}
