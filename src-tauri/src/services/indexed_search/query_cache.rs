// Indexed-search query cache and read path.
//
// Queries are read-only catalog work, but repeated keystrokes can ask the same
// question several times while the catalog revision is unchanged. This module
// keeps that cache policy away from lifecycle and worker code.
use std::sync::atomic::Ordering;

use crate::domain::{
    file_search::{FileSearch, FileSearchFilters},
    indexed_search::{
        IndexedFolderPageQuery, IndexedPathMatch, IndexedPathPage, IndexedPathPageQuery,
        IndexedPathQuery,
    },
};

use super::{
    catalog::IndexedCatalogStore, service::IndexedSearchHandle, state::normalize_drive_key,
};

const QUERY_CACHE_CAPACITY: usize = 24;

pub(super) struct QueryCache {
    entries: Vec<QueryCacheEntry>,
}

struct QueryCacheEntry {
    key: QueryCacheKey,
    revision: u64,
    volumes: Vec<(String, String)>,
    page: IndexedPathPage,
}

#[derive(Debug, Eq, PartialEq)]
struct QueryCacheKey {
    paged: bool,
    name: String,
    filters: FileSearchFilters,
    limit: usize,
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

    pub fn query_folder_page(
        &self,
        query: IndexedFolderPageQuery,
    ) -> Result<IndexedPathPage, String> {
        if query.search.trim().is_empty()
            || query.scope.scope_roots.as_ref().is_some_and(Vec::is_empty)
        {
            return Ok(IndexedPathPage::default());
        }
        self.query_catalog(None, |catalog, volumes| {
            catalog.query_folder_page(query, volumes)
        })
    }

    pub fn verify_searchable_drive(&self, drive_path: &str) -> bool {
        if self.is_shutting_down() || !self.is_enabled() {
            return false;
        }
        let key = normalize_drive_key(drive_path);
        let mount = {
            let state = self.inner.state.lock().expect("indexed search state lock");
            if !state.volumes.verified.contains(&key) {
                return false;
            }
            state.volumes.mounted.get(&key).cloned()
        };
        mount.is_some_and(|mount| mount.verify().is_ok())
    }

    fn query_catalog(
        &self,
        cache_key: Option<QueryCacheKey>,
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

        let cached = cache_key.as_ref().and_then(|key| {
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

fn build_query_cache_key(query: &IndexedPathQuery, paged: bool) -> QueryCacheKey {
    let parsed = FileSearch::parse(&query.query);
    QueryCacheKey {
        paged,
        name: parsed.name_query.trim().to_lowercase(),
        filters: parsed.filters,
        limit: query.effective_limit(),
    }
}

impl QueryCache {
    pub(super) fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    fn get(
        &mut self,
        key: &QueryCacheKey,
        revision: u64,
        volumes: &[(String, String)],
    ) -> Option<IndexedPathPage> {
        let index = self.entries.iter().position(|entry| {
            entry.revision == revision && &entry.key == key && entry.volumes == volumes
        })?;
        let entry = self.entries.remove(index);
        let page = entry.page.clone();
        self.entries.insert(0, entry);
        Some(page)
    }

    fn store(
        &mut self,
        key: QueryCacheKey,
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

    #[test]
    fn query_cache_keys_keep_parsed_size_and_type_criteria() {
        let key = |query: &str| {
            build_query_cache_key(
                &IndexedPathQuery {
                    query: query.into(),
                    limit: None,
                },
                true,
            )
        };
        assert_eq!(
            key(">1GB TYPE:VIDEO Concert"),
            key("concert type:video >1GiB")
        );
        assert_ne!(key("concert >1GB"), key("concert >=1GB"));
        assert_ne!(key("concert type:video"), key("concert type:audio"));
        assert_ne!(key(">1KB concert"), key(">1KB concert"));
    }
}
