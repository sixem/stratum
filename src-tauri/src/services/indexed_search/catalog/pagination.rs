// Paged search seeks past the last visible key, with strong name matches first.
use rusqlite::{params_from_iter, types::Value, Connection};
use serde::{Deserialize, Serialize};

use crate::domain::{
    file_search::FileSearchFilters,
    indexed_search::{
        IndexedFolderPageQuery, IndexedFolderScope, IndexedPathPage, IndexedPathPageQuery,
        IndexedPathQuery,
    },
};

use super::{
    query::{
        build_folder_path_sql, build_hits_sql, build_ordered_substring_probe_sql, build_query_plan,
        exclusive_prefix_end, register_file_type_filter, FolderPathPlan, NameSeek, PrefixFilter,
    },
    search_index, CatalogQueryHit, IndexedCatalogStore, QueryPlan,
};

const ORDERED_PROBE_CANDIDATES: usize = 256;

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
enum PageTier {
    Prefix,
    Substring,
    Path,
}

#[derive(Deserialize, Serialize)]
struct PageCursor {
    query: String,
    tier: PageTier,
    name: String,
    id: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    folder_scope: Option<IndexedFolderScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_filters: Option<FileSearchFilters>,
}

struct PageHit {
    hit: CatalogQueryHit,
    tier: PageTier,
    id: i64,
}

struct PageFilters<'a> {
    verified_volumes: &'a [(String, String)],
    folder_scope: Option<&'a IndexedFolderScope>,
}

impl IndexedCatalogStore {
    pub(in crate::services::indexed_search) fn query_page(
        &self,
        query: IndexedPathPageQuery,
        verified_volumes: &[(String, String)],
    ) -> Result<IndexedPathPage, String> {
        self.query_filtered_page(query, verified_volumes, None)
    }

    pub(in crate::services::indexed_search) fn query_folder_page(
        &self,
        query: IndexedFolderPageQuery,
        verified_volumes: &[(String, String)],
    ) -> Result<IndexedPathPage, String> {
        let mut scope = query.scope;
        let scoped_volumes;
        let volumes = if let Some(roots) = &mut scope.scope_roots {
            for root in roots.iter_mut() {
                let normalized = root.trim().trim_end_matches(['\\', '/']);
                let [letter, b':'] = normalized.as_bytes() else {
                    return Err("Indexed folder scopes must be drive roots.".into());
                };
                if !letter.is_ascii_alphabetic() {
                    return Err("Indexed folder scopes must be drive roots.".into());
                }
                *root = format!("{}:\\", letter.to_ascii_uppercase() as char);
            }
            roots.sort_unstable();
            roots.dedup();
            // The normal catalog identity check still applies to every selected drive.
            scoped_volumes = verified_volumes
                .iter()
                .filter(|(root, _)| roots.iter().any(|allow| allow.eq_ignore_ascii_case(root)))
                .cloned()
                .collect::<Vec<_>>();
            scoped_volumes.as_slice()
        } else {
            verified_volumes
        };
        self.query_filtered_page(
            IndexedPathPageQuery {
                search: IndexedPathQuery {
                    query: query.search,
                    limit: query.limit,
                },
                cursor: query.cursor,
            },
            volumes,
            Some(&scope),
        )
    }

    fn query_filtered_page(
        &self,
        query: IndexedPathPageQuery,
        verified_volumes: &[(String, String)],
        folder_scope: Option<&IndexedFolderScope>,
    ) -> Result<IndexedPathPage, String> {
        if verified_volumes.is_empty()
            || (folder_scope.is_some() && query.search.query.trim().is_empty())
        {
            return Ok(IndexedPathPage::default());
        }
        let mut connection = self.connect()?;
        // Exact and prefix hits can share one index range. Read both tiers from
        // the same snapshot when a page begins in that range and ends outside it.
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Failed to start indexed-search page: {error}"))?;
        read_filtered_page(&transaction, query, verified_volumes, true, folder_scope)
    }
}

// Keep the probe and FTS fallback in the caller's read snapshot. Tests can
// compare them there while the catalog writer continues to publish changes.
#[cfg(test)]
pub(super) fn read_page(
    connection: &Connection,
    query: IndexedPathPageQuery,
    verified_volumes: &[(String, String)],
    allow_ordered_probe: bool,
) -> Result<IndexedPathPage, String> {
    read_filtered_page(
        connection,
        query,
        verified_volumes,
        allow_ordered_probe,
        None,
    )
}

fn read_filtered_page(
    connection: &Connection,
    query: IndexedPathPageQuery,
    verified_volumes: &[(String, String)],
    allow_ordered_probe: bool,
    folder_scope: Option<&IndexedFolderScope>,
) -> Result<IndexedPathPage, String> {
    if verified_volumes.is_empty() {
        return Ok(IndexedPathPage::default());
    }
    if let Some((scope, plan)) = folder_scope
        .and_then(|scope| FolderPathPlan::parse(&query.search.query).map(|plan| (scope, plan)))
    {
        return read_folder_path_page(connection, query, verified_volumes, scope, plan);
    }
    let fts_ready = !search_index::needs_backfill(connection)?;
    let Some(plan) = build_query_plan(query.search, fts_ready, folder_scope.is_none()) else {
        return Ok(IndexedPathPage::default());
    };
    let prefix_end = exclusive_prefix_end(&plan.normalized_query);
    let prefix = plan.prefix_filter(prefix_end.as_deref());
    let cursor = read_cursor(
        query.cursor,
        &plan.normalized_query,
        folder_scope,
        plan.filters.as_ref(),
        |tier| tier == PageTier::Substring || (tier == PageTier::Prefix && prefix.is_some()),
    )?;
    register_file_type_filter(connection, &plan)?;

    let filters = PageFilters {
        verified_volumes,
        folder_scope,
    };
    let cursor = cursor.as_ref();
    // One lookahead row is enough to know whether continuation exists.
    let fetch_limit = plan.limit + 1;
    let mut hits = Vec::new();
    if let Some(prefix) = prefix.filter(|_| cursor.is_none_or(|key| key.tier == PageTier::Prefix)) {
        hits = fetch_page_tier(
            connection,
            &plan,
            &filters,
            Some(prefix),
            PageTier::Prefix,
            cursor,
            fetch_limit,
        )?;
    }
    let remaining = fetch_limit - hits.len();
    if remaining > 0 {
        let outside_prefix = prefix.map(|prefix| PrefixFilter {
            include: false,
            ..prefix
        });
        let after = cursor.filter(|key| key.tier == PageTier::Substring);
        let mut substring_hits = if allow_ordered_probe && plan.match_expression.is_some() {
            let (sql, params) = build_ordered_substring_probe_sql(
                &plan,
                verified_volumes,
                outside_prefix,
                after.map(|key| (key.name.as_str(), key.id)),
                ORDERED_PROBE_CANDIDATES,
                folder_scope,
            );
            read_hits(connection, sql, params, PageTier::Substring, remaining)?
        } else {
            Vec::new()
        };

        // Accept only a complete page including lookahead. A partial window
        // leaves the rest of the search to the normal substring query.
        if substring_hits.len() < remaining {
            substring_hits = fetch_page_tier(
                connection,
                &plan,
                &filters,
                outside_prefix,
                PageTier::Substring,
                after,
                remaining,
            )?;
        }
        hits.extend(substring_hits);
    }
    finish_page(
        hits,
        plan.limit,
        plan.normalized_query,
        folder_scope,
        plan.filters,
    )
}

fn read_folder_path_page(
    connection: &Connection,
    query: IndexedPathPageQuery,
    verified_volumes: &[(String, String)],
    scope: &IndexedFolderScope,
    plan: FolderPathPlan,
) -> Result<IndexedPathPage, String> {
    let normalized_query = plan.normalized_query.clone();
    let limit = query.search.effective_limit();
    let cursor = read_cursor(query.cursor, &normalized_query, Some(scope), None, |tier| {
        tier == PageTier::Path
    })?;
    let (sql, params) = build_folder_path_sql(
        connection,
        plan,
        verified_volumes,
        scope,
        cursor.as_ref().map(|key| (key.name.as_str(), key.id)),
    )?;
    let hits = read_hits(connection, sql, params, PageTier::Path, limit + 1)?;
    finish_page(hits, limit, normalized_query, Some(scope), None)
}

fn read_cursor(
    cursor: Option<String>,
    query: &str,
    folder_scope: Option<&IndexedFolderScope>,
    file_filters: Option<&FileSearchFilters>,
    tier_matches: impl FnOnce(PageTier) -> bool,
) -> Result<Option<PageCursor>, String> {
    let cursor = cursor
        .as_deref()
        .map(serde_json::from_str::<PageCursor>)
        .transpose()
        .map_err(|_| "Invalid indexed-search cursor.".to_owned())?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.query != query
            || cursor.folder_scope.as_ref() != folder_scope
            || cursor.file_filters.as_ref() != file_filters
            || !tier_matches(cursor.tier)
    }) {
        return Err("This indexed-search cursor belongs to another query.".to_owned());
    }
    Ok(cursor)
}

fn finish_page(
    mut hits: Vec<PageHit>,
    limit: usize,
    query: String,
    folder_scope: Option<&IndexedFolderScope>,
    file_filters: Option<FileSearchFilters>,
) -> Result<IndexedPathPage, String> {
    let has_more = hits.len() > limit;
    hits.truncate(limit);
    let next_cursor = hits
        .last()
        .filter(|_| has_more)
        .map(|last| {
            serde_json::to_string(&PageCursor {
                query,
                tier: last.tier,
                name: last.hit.normalized_name.clone(),
                id: last.id,
                folder_scope: folder_scope.cloned(),
                file_filters,
            })
        })
        .transpose()
        .map_err(|error| format!("Failed to encode indexed-search cursor: {error}"))?;

    Ok(IndexedPathPage {
        matches: hits.into_iter().map(|result| result.hit.into()).collect(),
        next_cursor,
    })
}

fn fetch_page_tier(
    connection: &Connection,
    plan: &QueryPlan,
    filters: &PageFilters<'_>,
    prefix: Option<PrefixFilter<'_>>,
    tier: PageTier,
    after: Option<&PageCursor>,
    limit: usize,
) -> Result<Vec<PageHit>, String> {
    let fetch = |seek, limit: usize| {
        let (sql, params) = build_hits_sql(
            plan,
            filters.verified_volumes,
            prefix,
            seek,
            filters.folder_scope,
        );
        read_hits(connection, sql, params, tier, limit)
    };
    let Some(after) = after else {
        return fetch(None, limit);
    };
    if tier == PageTier::Substring && plan.match_expression.is_some() {
        // The trigram index already narrows the scan. Avoid fetching the FTS
        // candidates twice when the cursor reaches the next distinct name.
        return fetch(Some(NameSeek::AfterKey(&after.name, after.id)), limit);
    }

    // The name index implicitly orders equal names by row ID. Separate the
    // seeks so SQLite can start at both keys without rescanning earlier ties.
    let mut hits = fetch(
        Some(NameSeek::EqualNameAfterId(&after.name, after.id)),
        limit,
    )?;
    if hits.len() < limit {
        hits.extend(fetch(
            Some(NameSeek::AfterName(&after.name)),
            limit - hits.len(),
        )?);
    }
    Ok(hits)
}

fn read_hits(
    connection: &Connection,
    mut sql: String,
    mut params: Vec<Value>,
    tier: PageTier,
    limit: usize,
) -> Result<Vec<PageHit>, String> {
    sql.push_str(" ORDER BY e.normalized_name, e.entry_id LIMIT ?");
    params.push(Value::from(limit as i64));
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("Failed to prepare indexed-search page: {error}"))?;
    let rows = statement
        .query_map(params_from_iter(params.iter()), |row| {
            Ok(PageHit {
                hit: CatalogQueryHit::read(row)?,
                tier,
                id: row.get(3)?,
            })
        })
        .map_err(|error| format!("Failed to run indexed-search page: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read indexed-search page: {error}"))
}
