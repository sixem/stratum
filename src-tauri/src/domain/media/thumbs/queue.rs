// Share pending renders across views and retire a view's interest on navigation.
use std::collections::{hash_map::Entry, HashMap, VecDeque};

use super::{ThumbJob, ThumbScope, ThumbView};

#[derive(Default)]
pub(super) struct ThumbQueue {
    pub(super) items: VecDeque<ThumbJob>,
    pub(super) paused: bool,
    generations: [u32; ThumbView::COUNT],
    active: [bool; ThumbView::COUNT],
    // Includes both waiting and running jobs. Only waiting jobs can be removed.
    interests: HashMap<String, [bool; ThumbView::COUNT]>,
}

impl ThumbQueue {
    pub(super) fn open_scope(&mut self, view: ThumbView) -> ThumbScope {
        let index = view.index();
        if self.active[index] {
            self.drop_interest(index);
        }
        self.active[index] = true;
        self.generations[index] = self.generations[index].wrapping_add(1);
        ThumbScope {
            view,
            generation: self.generations[index],
        }
    }

    pub(super) fn close_scope(&mut self, scope: ThumbScope) {
        if self.is_current(scope) {
            let index = scope.view.index();
            self.active[index] = false;
            self.drop_interest(index);
        }
    }

    pub(super) fn is_current(&self, scope: ThumbScope) -> bool {
        let index = scope.view.index();
        self.active[index] && self.generations[index] == scope.generation
    }

    fn drop_interest(&mut self, index: usize) {
        self.items.retain(|job| {
            let interests = self
                .interests
                .get_mut(&job.id)
                .expect("queued thumb interests");
            interests[index] = false;
            let keep = interests.iter().any(|&interested| interested);
            if !keep {
                self.interests.remove(&job.id);
            }
            keep
        });
    }

    pub(super) fn enqueue(&mut self, scope: ThumbScope, job: ThumbJob) -> bool {
        // A view may have closed while the request was preparing to enqueue.
        if !self.is_current(scope) {
            return false;
        }
        let index = scope.view.index();
        match self.interests.entry(job.id.clone()) {
            Entry::Occupied(mut entry) => {
                entry.get_mut()[index] = true;
                false
            }
            Entry::Vacant(entry) => {
                let mut interests = [false; ThumbView::COUNT];
                interests[index] = true;
                entry.insert(interests);
                // Prioritize the latest requests so the current view fills sooner.
                self.items.push_front(job);
                true
            }
        }
    }

    pub(super) fn finish(&mut self, job: &ThumbJob) {
        self.interests.remove(&job.id);
    }
}

#[cfg(test)]
mod tests;
