// A single writer drains this queue. When too many distinct changes arrive,
// a drive rebuild replaces its pending paths and picks up the latest state.
use std::{
    collections::{BTreeMap, VecDeque},
    thread::JoinHandle,
    time::{Duration, Instant},
};

const MAX_PENDING_PATHS: usize = 512;
const MAX_WATCHED_PATHS: usize = 128;
const WATCH_BATCH_SIZE: usize = 16;
const JOURNAL_HINT_DELAY: Duration = Duration::from_millis(250);
const JOURNAL_HINT_INTERVAL: Duration = Duration::from_secs(2);
const MAX_VISITED_FOLDERS: usize = 16;

#[derive(Default)]
pub(super) struct WorkQueue {
    volume_check_pending: bool,
    // Each journal or FTS batch rejoins the tail after it commits. This lets
    // other drives and the search migration make progress between batches.
    background: VecDeque<Work>,
    journal_hints: BTreeMap<String, Instant>,
    last_journal_check: BTreeMap<String, Instant>,
    count_refreshes: VecDeque<String>,
    rebuilds: VecDeque<String>,
    paths: BTreeMap<String, String>,
    watched_paths: VecDeque<WatchedPath>,
    visited_folders: VecDeque<String>,
    size_backfill_pending: bool,
    pub(super) active_drive: Option<String>,
    pub(super) running: bool,
    pub(super) thread: Option<JoinHandle<()>>,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) enum Work {
    CheckVolumes,
    ContinueJournal(String),
    BackfillSearch,
    BackfillFileSizes,
    RefreshDriveCount(String),
    Rebuild(String),
    Reconcile(Vec<String>),
    ReconcileWatched(Vec<WatchedPath>),
    ReconcileVisitedFolder(String),
}

#[derive(Debug, Eq, PartialEq)]
pub(super) struct WatchedPath {
    pub(super) path: String,
    pub(super) size_only: bool,
}

impl WorkQueue {
    pub(super) fn discard_out_of_scope(&mut self, includes: impl Fn(&str) -> bool) {
        self.rebuilds.retain(|drive| includes(drive));
        self.paths.retain(|_, path| includes(&path[..3]));
        self.watched_paths.retain(|hint| includes(&hint.path[..3]));
        self.visited_folders.retain(|folder| includes(&folder[..3]));
        self.journal_hints.retain(|drive, _| includes(drive));
        self.last_journal_check.retain(|drive, _| includes(drive));
        self.count_refreshes.retain(|drive| includes(drive));
        self.background.retain(|work| match work {
            Work::ContinueJournal(drive) => includes(drive),
            _ => true,
        });
    }

    pub(super) fn queue_volume_check(&mut self) {
        self.volume_check_pending = true;
    }

    pub(super) fn queue_search_backfill(&mut self) {
        self.queue_background(Work::BackfillSearch);
    }

    pub(super) fn queue_size_backfill(&mut self) {
        self.size_backfill_pending = true;
    }

    pub(super) fn queue_drive_count(&mut self, drive: String) {
        if !self.has_queued_rebuild(&drive) && !self.count_refreshes.contains(&drive) {
            self.count_refreshes.push_back(drive);
        }
    }

    pub(super) fn queue_journal_continuation(&mut self, drive: String) {
        self.journal_hints.remove(&drive);
        if !self.rebuilds.contains(&drive) {
            self.queue_background(Work::ContinueJournal(drive));
        }
    }

    pub(super) fn queue_journal_hint(&mut self, drive: String, now: Instant) -> bool {
        if self.active_drive.as_ref() == Some(&drive)
            || self.has_queued_rebuild(&drive)
            || self.journal_hints.contains_key(&drive)
            || self
                .background
                .iter()
                .any(|work| matches!(work, Work::ContinueJournal(queued) if queued == &drive))
        {
            return false;
        }
        let due = (now + JOURNAL_HINT_DELAY).max(
            self.last_journal_check
                .get(&drive)
                .map_or(now, |last| *last + JOURNAL_HINT_INTERVAL),
        );
        self.journal_hints.insert(drive, due);
        true
    }

    pub(super) fn next_journal_hint(&self) -> Option<Instant> {
        self.journal_hints.values().copied().min()
    }

    pub(super) fn note_journal_check(&mut self, drive: &str, now: Instant) {
        self.last_journal_check.insert(drive.to_owned(), now);
        self.journal_hints.remove(drive);
        self.background
            .retain(|work| !matches!(work, Work::ContinueJournal(queued) if queued == drive));
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
        self.watched_paths
            .retain(|hint| !hint.path.starts_with(&drive));
        self.visited_folders
            .retain(|folder| !folder.starts_with(&drive));
        self.journal_hints.remove(&drive);
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
            .retain(|watched| !covers_path(&path, &watched.path));
        self.paths.insert(key, path);
        false
    }

    pub(super) fn queue_watched_path(&mut self, drive: &str, path: String, size_only: bool) {
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
        if size_only
            && self
                .watched_paths
                .iter()
                .any(|hint| hint.path == path && !hint.size_only)
        {
            return;
        }
        self.watched_paths.retain(|hint| hint.path != path);
        if self.watched_paths.len() < MAX_WATCHED_PATHS {
            self.watched_paths
                .push_back(WatchedPath { path, size_only });
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        !self.volume_check_pending
            && self.background.is_empty()
            && self.journal_hints.is_empty()
            && self.count_refreshes.is_empty()
            && self.rebuilds.is_empty()
            && self.paths.is_empty()
            && self.watched_paths.is_empty()
            && self.visited_folders.is_empty()
            && !self.size_backfill_pending
    }

    pub(super) fn has_size_backfill(&self) -> bool {
        self.size_backfill_pending
    }

    pub(super) fn queue_visited_folder(&mut self, drive: &str, folder: String) {
        if self.has_queued_rebuild(drive)
            || self.active_drive.as_deref() == Some(drive)
            || self.visited_folders.contains(&folder)
            || self
                .paths
                .values()
                .any(|pending| covers_path(pending, &folder))
        {
            return;
        }
        if self.visited_folders.len() == MAX_VISITED_FOLDERS {
            self.visited_folders.pop_front();
        }
        self.visited_folders.push_back(folder);
    }

    #[cfg(test)]
    pub(super) fn next(&mut self) -> Option<Work> {
        self.next_ready(Instant::now(), true)
    }

    pub(super) fn next_ready(&mut self, now: Instant, allow_size_backfill: bool) -> Option<Work> {
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
        self.journal_hints.retain(|drive, due| {
            if *due > now {
                return true;
            }
            self.background
                .push_back(Work::ContinueJournal(drive.clone()));
            false
        });
        if let Some(work) = self.background.pop_front() {
            return Some(work);
        }
        if !self.watched_paths.is_empty() {
            let paths = (0..WATCH_BATCH_SIZE)
                .map_while(|_| self.watched_paths.pop_front())
                .collect();
            return Some(Work::ReconcileWatched(paths));
        }
        if let Some(folder) = self.visited_folders.pop_front() {
            return Some(Work::ReconcileVisitedFolder(folder));
        }
        if let Some(drive) = self.count_refreshes.pop_front() {
            return Some(Work::RefreshDriveCount(drive));
        }
        (allow_size_backfill && std::mem::take(&mut self.size_backfill_pending))
            .then_some(Work::BackfillFileSizes)
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
    fn journal_hints_coalesce_and_keep_a_trailing_check_after_the_rate_limit() {
        let mut queue = WorkQueue::default();
        let drive = String::from(r"C:\");
        let start = Instant::now();
        let first_due = start + JOURNAL_HINT_DELAY;
        queue.queue_journal_hint(drive.clone(), start);
        queue.queue_journal_hint(drive.clone(), start + Duration::from_millis(10));
        assert_eq!(queue.next_journal_hint(), Some(first_due));
        assert_eq!(queue.next_ready(start, true), None);
        queue.queue_search_backfill();
        assert_eq!(
            queue.next_ready(first_due, true),
            Some(Work::BackfillSearch)
        );
        assert_eq!(
            queue.next_ready(first_due, true),
            Some(Work::ContinueJournal(drive.clone()))
        );
        queue.note_journal_check(&drive, first_due);

        let trailing_due = first_due + JOURNAL_HINT_INTERVAL;
        queue.queue_journal_hint(drive.clone(), first_due + Duration::from_millis(5));
        assert_eq!(queue.next_journal_hint(), Some(trailing_due));
        assert_eq!(queue.next_ready(first_due + JOURNAL_HINT_DELAY, true), None);
        assert_eq!(
            queue.next_ready(trailing_due, true),
            Some(Work::ContinueJournal(drive.clone()))
        );
        queue.note_journal_check(&drive, trailing_due);

        queue.queue_journal_hint(drive.clone(), trailing_due + Duration::from_secs(4));
        queue.queue_journal_continuation(drive.clone());
        assert_eq!(queue.next_journal_hint(), None);
        assert_eq!(
            queue.next_ready(trailing_due, true),
            Some(Work::ContinueJournal(drive))
        );
        assert!(queue.is_empty());
    }

    #[test]
    fn folder_visit_hints_are_bounded_and_never_queue_a_drive_rebuild() {
        let mut queue = WorkQueue::default();
        let drive = r"C:\";
        for index in 0..=MAX_VISITED_FOLDERS {
            let folder = format!("{drive}folder{index}");
            queue.queue_visited_folder(drive, folder.clone());
            queue.queue_visited_folder(drive, folder);
        }
        assert_eq!(queue.visited_folders.len(), MAX_VISITED_FOLDERS);
        assert_eq!(
            queue.next(),
            Some(Work::ReconcileVisitedFolder(format!("{drive}folder1")))
        );
        assert!(queue.queue_rebuild(drive.to_owned()));
        assert_eq!(queue.next(), Some(Work::Rebuild(drive.to_owned())));
        assert!(queue.is_empty());
    }

    #[test]
    fn watched_paths_stay_bounded_and_manual_work_covers_pending_watches() {
        let mut queue = WorkQueue::default();
        let drive = "C:\\".to_string();
        queue.queue_watched_path(&drive, drive.clone(), false);
        assert!(queue.is_empty());
        for index in 0..(MAX_WATCHED_PATHS + 1) {
            queue.queue_watched_path(&drive, format!("{drive}folder\\{index:03}.txt"), false);
        }
        assert_eq!(queue.watched_paths.len(), MAX_WATCHED_PATHS);
        let Some(Work::ReconcileWatched(first)) = queue.next() else {
            panic!("expected bounded folder work");
        };
        assert_eq!(first.len(), WATCH_BATCH_SIZE);
        let parent = format!("{drive}folder");
        assert!(!queue.queue_path(drive.clone(), parent.clone()));
        queue.queue_watched_path(&drive, format!("{parent}\\redundant.txt"), false);
        assert_eq!(queue.next(), Some(Work::Reconcile(vec![parent])));
        assert!(queue.is_empty());

        queue.queue_watched_path(&drive, format!("{drive}new.txt"), false);
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
        queue.queue_watched_path(drive, new.clone(), true);
        queue.queue_watched_path(drive, old.clone(), false);
        queue.queue_watched_path(drive, new.clone(), false);
        queue.queue_watched_path(drive, old.clone(), true);
        queue.queue_size_backfill();
        assert_eq!(
            queue.next(),
            Some(Work::ReconcileWatched(vec![
                WatchedPath {
                    path: old,
                    size_only: false
                },
                WatchedPath {
                    path: new,
                    size_only: false
                },
            ]))
        );
        assert_eq!(queue.next_ready(Instant::now(), false), None);
        assert_eq!(queue.next(), Some(Work::BackfillFileSizes));
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
