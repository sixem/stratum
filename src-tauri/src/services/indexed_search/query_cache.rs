// Indexed-search query cache and read path.
//
// Queries are read-only catalog work, but repeated keystrokes can ask the same
// question several times while the catalog revision is unchanged. This module
// keeps that cache policy away from lifecycle and worker code.
use std::sync::atomic::Ordering;

use crate::domain::indexed_search::{
    IndexedPathMatch, IndexedPathPage, IndexedPathPageQuery, IndexedPathQuery,
};

use super::{catalog::IndexedCatalogStore, service::IndexedSearchHandle};

const QUERY_CACHE_CAPACITY: usize = 24;

pub(super) struct QueryCache {
    entries: Vec<QueryCacheEntry>,
}

struct QueryCacheEntry {
    key: String,
    revision: u64,
    volumes: Vec<(String, String)>,
    page: IndexedPathPage,
}

impl IndexedSearchHandle {
    pub fn query_paths(&self, query: IndexedPathQuery) -> Result<Vec<IndexedPathMatch>, String> {
        let key = build_query_cache_key(&query, false);
        self.query_catalog(Some(key), |catalog, volumes| {
            Ok(IndexedPathPage {
                matches: catalog.query(query, volumes)?,
                next_cursor: None,
            })
        })
        .map(|page| page.matches)
    }

    pub fn query_path_page(&self, query: IndexedPathPageQuery) -> Result<IndexedPathPage, String> {
        // Revisited search terms can reuse their first page. Later pages are
        // consumed incrementally and should not evict those cached searches.
        let key = query
            .cursor
            .is_none()
            .then(|| build_query_cache_key(&query.search, true));
        self.query_catalog(key, |catalog, volumes| catalog.query_page(query, volumes))
    }

    fn query_catalog(
        &self,
        cache_key: Option<String>,
        fetch: impl FnOnce(&IndexedCatalogStore, &[(String, String)]) -> Result<IndexedPathPage, String>,
    ) -> Result<IndexedPathPage, String> {
        if self.is_shutting_down() || !self.is_enabled() {
            return Ok(IndexedPathPage::default());
        }

        let Some(result) = self.inner.catalog.get() else {
            return Ok(IndexedPathPage::default());
        };
        let catalog = result.as_ref().map_err(Clone::clone)?;

        // A drive letter can change between background checks. Check the
        // physical binding before either the cache lookup or the SQL read.
        let (revision, mounts) = {
            let state = self.inner.state.lock().expect("indexed search state lock");
            (self.catalog_revision(), state.volumes.verified_mounts())
        };
        let volumes = mounts
            .into_iter()
            .filter(|mount| mount.verify().is_ok())
            .map(|mount| (mount.drive_path, mount.identity))
            .collect::<Vec<_>>();
        if volumes.is_empty() {
            return Ok(IndexedPathPage::default());
        }

        let cached = cache_key.as_deref().and_then(|key| {
            self.inner
                .query_cache
                .lock()
                .expect("indexed search query cache lock")
                .get(key, revision, &volumes)
        });
        let mut page = match cached {
            Some(page) => page,
            None => {
                let page = fetch(catalog, &volumes)?;
                if let Some(key) = cache_key {
                    self.inner
                        .query_cache
                        .lock()
                        .expect("indexed search query cache lock")
                        .store(key, revision, volumes.clone(), page.clone());
                }
                page
            }
        };

        if self.is_shutting_down() || !self.is_enabled() {
            return Ok(IndexedPathPage::default());
        }
        if self.catalog_revision() != revision {
            // Unmount or invalidation can race a read. Exclude any result
            // whose original binding is no longer in the verified scope.
            let state = self.inner.state.lock().expect("indexed search state lock");
            let current = state.volumes.verified_mounts();
            page.matches.retain(|hit| {
                hit.drive_path.as_ref().is_some_and(|drive| {
                    volumes.iter().any(|(root, id)| {
                        root.eq_ignore_ascii_case(drive)
                            && current
                                .iter()
                                .any(|mount| &mount.drive_path == root && &mount.identity == id)
                    })
                })
            });
        }
        Ok(page)
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

fn build_query_cache_key(query: &IndexedPathQuery, paged: bool) -> String {
    let normalized_query = query.query.trim().to_lowercase();
    let normalized_limit = query.effective_limit();
    format!("{paged}\n{normalized_query}\n{normalized_limit}")
}

impl QueryCache {
    pub(super) fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    fn get(
        &mut self,
        key: &str,
        revision: u64,
        volumes: &[(String, String)],
    ) -> Option<IndexedPathPage> {
        let index = self.entries.iter().position(|entry| {
            entry.revision == revision && entry.key == key && entry.volumes == volumes
        })?;
        let entry = self.entries.remove(index);
        let page = entry.page.clone();
        self.entries.insert(0, entry);
        Some(page)
    }

    fn store(
        &mut self,
        key: String,
        revision: u64,
        volumes: Vec<(String, String)>,
        page: IndexedPathPage,
    ) {
        self.entries.retain(|entry| {
            !(entry.revision == revision && entry.key == key && entry.volumes == volumes)
        });
        self.entries.insert(
            0,
            QueryCacheEntry {
                key,
                revision,
                volumes,
                page,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_cache_keys_use_the_effective_result_limit() {
        let key = |limit| {
            build_query_cache_key(
                &IndexedPathQuery {
                    query: "example".into(),
                    limit,
                },
                false,
            )
        };
        assert_ne!(key(None), key(Some(0)));
        assert_eq!(key(None), key(Some(50)));
        assert_eq!(key(Some(0)), key(Some(1)));
        assert_eq!(key(Some(100)), key(Some(usize::MAX)));
    }
}
