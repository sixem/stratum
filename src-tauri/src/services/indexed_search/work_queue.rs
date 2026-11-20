// A single writer drains this queue. When too many distinct changes arrive,
// a drive rebuild replaces its pending paths and picks up the latest state.
use std::{
    collections::{BTreeMap, VecDeque},
    thread::JoinHandle,
};

const MAX_PENDING_PATHS: usize = 512;
const MAX_WATCHED_PATHS: usize = 128;
const WATCH_BATCH_SIZE: usize = 16;

#[derive(Default)]
pub(super) struct WorkQueue {
    volume_check_pending: bool,
    // Each journal or FTS batch rejoins the tail after it commits. This lets
    // other drives and the search migration make progress between batches.
    background: VecDeque<Work>,
    count_refreshes: VecDeque<String>,
    rebuilds: VecDeque<String>,
    paths: BTreeMap<String, String>,
    watched_paths: VecDeque<String>,
    pub(super) active_drive: Option<String>,
    pub(super) running: bool,
    pub(super) thread: Option<JoinHandle<()>>,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) enum Work {
    CheckVolumes,
    ContinueJournal(String),
    BackfillSearch,
    RefreshDriveCount(String),
    Rebuild(String),
    Reconcile(Vec<String>),
    ReconcileWatched(Vec<String>),
}

impl WorkQueue {
    pub(super) fn queue_volume_check(&mut self) {
        self.volume_check_pending = true;
    }

    pub(super) fn queue_search_backfill(&mut self) {
        self.queue_background(Work::BackfillSearch);
    }

    pub(super) fn queue_drive_count(&mut self, drive: String) {
        if !self.has_queued_rebuild(&drive) && !self.count_refreshes.contains(&drive) {
            self.count_refreshes.push_back(drive);
        }
    }

    pub(super) fn queue_journal_continuation(&mut self, drive: String) {
        if !self.rebuilds.contains(&drive) {
            self.queue_background(Work::ContinueJournal(drive));
        }
    }

    fn queue_background(&mut self, work: Work) {
        if !self.background.contains(&work) {
            self.background.push_back(work);
        }
    }

    pub(super) fn has_queued_rebuild(&self, drive: &str) -> bool {
        self.rebuilds.iter().any(|queued| queued == drive)
    }

    pub(super) fn queue_rebuild(&mut self, drive: String) -> bool {
        if self.has_queued_rebuild(&drive) {
            return false;
        }
        let drive_prefix = drive.to_ascii_lowercase();
        self.paths.retain(|key, _| !key.starts_with(&drive_prefix));
        self.watched_paths.retain(|path| !path.starts_with(&drive));
        self.count_refreshes.retain(|pending| pending != &drive);
        self.background
            .retain(|work| !matches!(work, Work::ContinueJournal(pending) if pending == &drive));
        self.rebuilds.push_back(drive);
        true
    }

    pub(super) fn queue_path(&mut self, drive: String, path: String) -> bool {
        if self.rebuilds.contains(&drive) {
            return false;
        }

        let key = path.to_ascii_lowercase();
        if let Some(existing) = self.paths.get(&key) {
            // Case-only renames need the spelling read from disk. This
            // also covers case-sensitive directories containing both names.
            return existing != &path && self.queue_rebuild(drive);
        }
        if self.paths.values().any(|parent| covers_path(parent, &path)) {
            return false;
        }

        self.paths.retain(|_, child| !covers_path(&path, child));
        if self.paths.len() >= MAX_PENDING_PATHS || path == drive {
            return self.queue_rebuild(drive);
        }
        self.watched_paths
            .retain(|watched| !covers_path(&path, watched));
        self.paths.insert(key, path);
        false
    }

    pub(super) fn queue_watched_path(&mut self, drive: &str, path: String) {
        // A busy directory can exhaust its notification buffer. Its best-effort
        // updates should never cause work to expand to an entire drive.
        if path == drive
            || self.rebuilds.iter().any(|pending| pending == drive)
            || self
                .paths
                .values()
                .any(|pending| covers_path(pending, &path))
        {
            return;
        }
        // Maintain event order for case-only renames. If a path already has
        // a pending hint, the newest position is the useful one.
        self.watched_paths.retain(|pending| pending != &path);
        if self.watched_paths.len() < MAX_WATCHED_PATHS {
            self.watched_paths.push_back(path);
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        !self.volume_check_pending
            && self.background.is_empty()
            && self.count_refreshes.is_empty()
            && self.rebuilds.is_empty()
            && self.paths.is_empty()
            && self.watched_paths.is_empty()
    }

    pub(super) fn next(&mut self) -> Option<Work> {
        if std::mem::take(&mut self.volume_check_pending) {
            return Some(Work::CheckVolumes);
        }
        if let Some(drive) = self.rebuilds.pop_front() {
            self.active_drive = Some(drive.clone());
            return Some(Work::Rebuild(drive));
        }
        if !self.paths.is_empty() {
            return Some(Work::Reconcile(
                std::mem::take(&mut self.paths).into_values().collect(),
            ));
        }
        if let Some(work) = self.background.pop_front() {
            return Some(work);
        }
        if self.watched_paths.is_empty() {
            return self
                .count_refreshes
                .pop_front()
                .map(Work::RefreshDriveCount);
        }
        let paths = (0..WATCH_BATCH_SIZE)
            .map_while(|_| self.watched_paths.pop_front())
            .collect();
        Some(Work::ReconcileWatched(paths))
    }
}

fn covers_path(parent: &str, child: &str) -> bool {
    child.strip_prefix(parent).is_some_and(|suffix| {
        suffix.is_empty() || suffix.starts_with('\\') || parent.ends_with('\\')
    })
}

pub(super) fn coalesce_paths(paths: Vec<String>) -> Option<Vec<String>> {
    let mut paths = paths
        .into_iter()
        .map(|path| (path.to_ascii_lowercase(), path))
        .collect::<Vec<_>>();
    paths.sort_unstable();
    let mut accepted: Vec<(String, String)> = Vec::new();
    for (key, path) in paths {
        if let Some((_, parent)) = accepted
            .iter()
            .find(|(candidate, _)| covers_path(candidate, &key))
        {
            if !covers_path(parent, &path) {
                // Two spellings may name separate NTFS entries or the same
                // subtree on a case-insensitive directory. Rescan that volume.
                return None;
            }
        } else {
            accepted.push((key, path));
        }
    }
    Some(accepted.into_iter().map(|(_, path)| path).collect())
}

pub(super) fn normalize_path(path: &str) -> Option<(String, String)> {
    let path = path.replace('/', "\\");
    let bytes = path.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' {
        return None;
    }
    let drive = path[..3].to_ascii_uppercase();
    let path = path.trim_end_matches('\\');
    let path = if path.len() == 2 {
        drive.clone()
    } else {
        format!("{}{}", &drive[..2], &path[2..])
    };
    Some((drive, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watched_paths_stay_bounded_and_manual_work_covers_pending_watches() {
        let mut queue = WorkQueue::default();
        let drive = "C:\\".to_string();
        queue.queue_watched_path(&drive, drive.clone());
        assert!(queue.is_empty());
        for index in 0..(MAX_WATCHED_PATHS + 1) {
            queue.queue_watched_path(&drive, format!("{drive}folder\\{index:03}.txt"));
        }
        assert_eq!(queue.watched_paths.len(), MAX_WATCHED_PATHS);
        let Some(Work::ReconcileWatched(first)) = queue.next() else {
            panic!("expected bounded folder work");
        };
        assert_eq!(first.len(), WATCH_BATCH_SIZE);
        let parent = format!("{drive}folder");
        assert!(!queue.queue_path(drive.clone(), parent.clone()));
        queue.queue_watched_path(&drive, format!("{parent}\\redundant.txt"));
        assert_eq!(queue.next(), Some(Work::Reconcile(vec![parent])));
        assert!(queue.is_empty());

        queue.queue_watched_path(&drive, format!("{drive}new.txt"));
        queue.queue_rebuild(drive.clone());
        assert_eq!(queue.next(), Some(Work::Rebuild(drive)));
        assert!(queue.is_empty());
    }

    #[test]
    fn watched_rename_hints_keep_source_before_destination() {
        let mut queue = WorkQueue::default();
        let drive = r"C:\";
        let old = r"C:\folder\note.txt".to_string();
        let new = r"C:\folder\NOTE.txt".to_string();
        queue.queue_watched_path(drive, new.clone());
        queue.queue_watched_path(drive, old.clone());
        queue.queue_watched_path(drive, new.clone());
        assert_eq!(queue.next(), Some(Work::ReconcileWatched(vec![old, new])));
    }

    #[test]
    fn journal_and_search_batches_take_turns_after_foreground_work() {
        let mut queue = WorkQueue::default();
        let c = r"C:\".to_string();
        let d = r"D:\".to_string();
        for _ in 0..2 {
            queue.queue_journal_continuation(c.clone());
            queue.queue_search_backfill();
            queue.queue_journal_continuation(d.clone());
        }
        assert_eq!(queue.next(), Some(Work::ContinueJournal(c.clone())));
        queue.queue_journal_continuation(c.clone());

        let path = r"C:\recent.txt".to_string();
        queue.queue_path(c.clone(), path.clone());
        queue.queue_volume_check();
        assert_eq!(queue.next(), Some(Work::CheckVolumes));
        assert_eq!(queue.next(), Some(Work::Reconcile(vec![path])));
        assert_eq!(queue.next(), Some(Work::BackfillSearch));
        queue.queue_search_backfill();
        assert_eq!(queue.next(), Some(Work::ContinueJournal(d)));
        assert_eq!(queue.next(), Some(Work::ContinueJournal(c)));
        assert_eq!(queue.next(), Some(Work::BackfillSearch));
        assert!(queue.is_empty());
    }

    #[test]
    fn rebuild_supersedes_only_its_own_journal_continuation() {
        let mut queue = WorkQueue::default();
        let c = r"C:\".to_string();
        let d = r"D:\".to_string();
        queue.queue_journal_continuation(c.clone());
        queue.queue_search_backfill();
        queue.queue_journal_continuation(d.clone());
        assert!(queue.queue_rebuild(c.clone()));
        queue.queue_journal_continuation(c.clone());

        assert_eq!(queue.next(), Some(Work::Rebuild(c)));
        assert_eq!(queue.next(), Some(Work::BackfillSearch));
        assert_eq!(queue.next(), Some(Work::ContinueJournal(d)));
        assert!(queue.is_empty());
    }

    #[test]
    fn coalesces_overlapping_paths_only_within_the_same_tree() {
        let mut queue = WorkQueue::default();
        for path in ["C:\\abc\\a.txt", "c:\\abc", "C:\\abc\\b.txt", "C:\\abcd"] {
            let (drive, path) = normalize_path(path).unwrap();
            assert!(!queue.queue_path(drive, path));
        }
        let Some(Work::Reconcile(paths)) = queue.next() else {
            panic!("expected path work");
        };
        assert_eq!(paths, ["C:\\abc", "C:\\abcd"]);
    }

    #[test]
    fn detects_overlapping_changes_with_distinct_case() {
        let parent = "C:\\Scope\\Folder";
        let child = "C:\\Scope\\folder\\child.txt";
        let mut queue = WorkQueue::default();
        for path in [parent, child] {
            let (drive, path) = normalize_path(path).unwrap();
            assert!(!queue.queue_path(drive, path));
        }
        let Some(Work::Reconcile(paths)) = queue.next() else {
            panic!("expected both subtrees");
        };
        assert_eq!(paths, [parent, child]);
        assert!(coalesce_paths(vec![child.into(), parent.into()]).is_none());
    }

    #[test]
    fn overflow_promotes_a_drive_and_keeps_other_drive_work() {
        let mut queue = WorkQueue::default();
        queue.queue_path("D:\\".into(), "D:\\keep.txt".into());
        for index in 0..MAX_PENDING_PATHS {
            let promoted = queue.queue_path("C:\\".into(), format!("C:\\file-{index}"));
            assert_eq!(promoted, index == MAX_PENDING_PATHS - 1);
            assert!(queue.paths.len() <= MAX_PENDING_PATHS);
        }
        assert!(!queue.queue_rebuild("C:\\".into()));
        assert!(matches!(queue.next(), Some(Work::Rebuild(drive)) if drive == "C:\\"));

        // A mutation while the rebuild is running must be reconciled later.
        queue.queue_path("C:\\".into(), "C:\\new.txt".into());
        let Some(Work::Reconcile(paths)) = queue.next() else {
            panic!("expected remaining path work");
        };
        assert_eq!(paths, ["C:\\new.txt", "D:\\keep.txt"]);
    }
}
