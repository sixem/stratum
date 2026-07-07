// Indexed-search query cache and read path.
//
// Queries are read-only catalog work, but repeated keystrokes can ask the same
// question several times while the catalog revision is unchanged. This module
// keeps that cache policy away from lifecycle and worker code.
use std::sync::atomic::Ordering;

use crate::domain::indexed_search::{
    IndexedPathMatch, IndexedPathQuery, IndexedSearchServiceState,
};

use super::service::IndexedSearchHandle;

const QUERY_CACHE_CAPACITY: usize = 24;

pub(super) struct QueryCache {
    entries: Vec<QueryCacheEntry>,
}

struct QueryCacheEntry {
    key: String,
    revision: u64,
    matches: Vec<IndexedPathMatch>,
}

impl IndexedSearchHandle {
    pub fn query_paths(&self, query: IndexedPathQuery) -> Vec<IndexedPathMatch> {
        if self.is_shutting_down() || !self.is_enabled() {
            return Vec::new();
        }

        let cache_key = build_query_cache_key(&query);
        let revision = self.catalog_revision();
        if let Some(matches) = self
            .inner
            .query_cache
            .lock()
            .expect("indexed search query cache lock")
            .get(&cache_key, revision)
        {
            return matches;
        }

        let Some(catalog) = self.inner.catalog.as_ref().cloned() else {
            self.mark_catalog_unavailable();
            return Vec::new();
        };

        match catalog.query(query) {
            Ok(matches) => {
                self.inner
                    .query_cache
                    .lock()
                    .expect("indexed search query cache lock")
                    .store(cache_key, revision, matches.clone());
                matches
            }
            Err(error) => {
                self.set_service_state(
                    IndexedSearchServiceState::Error,
                    Some(format!("Indexed search query failed: {error}")),
                );
                Vec::new()
            }
        }
    }

    pub(super) fn catalog_revision(&self) -> u64 {
        self.inner.catalog_revision.load(Ordering::SeqCst)
    }

    pub(super) fn bump_catalog_revision(&self) {
        self.inner.catalog_revision.fetch_add(1, Ordering::SeqCst);
        self.clear_query_cache();
    }

    pub(super) fn clear_query_cache(&self) {
        self.inner
            .query_cache
            .lock()
            .expect("indexed search query cache lock")
            .clear();
    }
}

fn build_query_cache_key(query: &IndexedPathQuery) -> String {
    let normalized_query = query.query.trim().to_lowercase();
    let normalized_limit = query.limit.unwrap_or(0);
    format!("{normalized_query}\n{normalized_limit}")
}

impl QueryCache {
    pub(super) fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    fn get(&mut self, key: &str, revision: u64) -> Option<Vec<IndexedPathMatch>> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.revision == revision && entry.key == key)?;
        let entry = self.entries.remove(index);
        let matches = entry.matches.clone();
        self.entries.insert(0, entry);
        Some(matches)
    }

    fn store(&mut self, key: String, revision: u64, matches: Vec<IndexedPathMatch>) {
        self.entries
            .retain(|entry| !(entry.revision == revision && entry.key == key));
        self.entries.insert(
            0,
            QueryCacheEntry {
                key,
                revision,
                matches,
            },
        );
        if self.entries.len() > QUERY_CACHE_CAPACITY {
            self.entries.truncate(QUERY_CACHE_CAPACITY);
        }
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}
