// Paged search seeks past the last visible key, with strong name matches first.
use rusqlite::{params_from_iter, types::Value, Connection};
use serde::{Deserialize, Serialize};

use crate::domain::indexed_search::{IndexedPathPage, IndexedPathPageQuery};

use super::{
    query::{
        build_hits_sql, build_ordered_substring_probe_sql, build_query_plan, exclusive_prefix_end,
        NameSeek, PrefixFilter,
    },
    search_index,
    writer::int_to_kind,
    CatalogQueryHit, IndexedCatalogStore, QueryPlan,
};

const ORDERED_PROBE_CANDIDATES: usize = 256;

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
enum PageTier {
    Prefix,
    Substring,
}

#[derive(Deserialize, Serialize)]
struct PageCursor {
    query: String,
    tier: PageTier,
    name: String,
    id: i64,
}

struct PageHit {
    hit: CatalogQueryHit,
    tier: PageTier,
    id: i64,
}

impl IndexedCatalogStore {
    pub(in crate::services::indexed_search) fn query_page(
        &self,
        query: IndexedPathPageQuery,
        verified_volumes: &[(String, String)],
    ) -> Result<IndexedPathPage, String> {
        if verified_volumes.is_empty() {
            return Ok(IndexedPathPage::default());
        }
        let mut connection = self.connect()?;
        // Exact and prefix hits can share one index range. Read both tiers from
        // the same snapshot when a page begins in that range and ends outside it.
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Failed to start indexed-search page: {error}"))?;
        read_page(&transaction, query, verified_volumes, true)
    }
}

// Keep the probe and FTS fallback in the caller's read snapshot. Tests can
// compare them there while the catalog writer continues to publish changes.
pub(super) fn read_page(
    connection: &Connection,
    query: IndexedPathPageQuery,
    verified_volumes: &[(String, String)],
    allow_ordered_probe: bool,
) -> Result<IndexedPathPage, String> {
    if verified_volumes.is_empty() {
        return Ok(IndexedPathPage::default());
    }
    let fts_ready = !search_index::needs_backfill(connection)?;
    let Some(plan) = build_query_plan(query.search, fts_ready) else {
        return Ok(IndexedPathPage::default());
    };
    let cursor = query
        .cursor
        .as_deref()
        .map(serde_json::from_str::<PageCursor>)
        .transpose()
        .map_err(|_| "Invalid indexed-search cursor.".to_owned())?;
    if cursor.as_ref().is_some_and(|cursor| {
        cursor.query != plan.normalized_query
            || (cursor.tier == PageTier::Prefix && plan.has_wildcards)
    }) {
        return Err("This indexed-search cursor belongs to another query.".to_owned());
    }

    let end = exclusive_prefix_end(&plan.normalized_query);
    let prefix = (!plan.has_wildcards).then_some(PrefixFilter {
        start: &plan.normalized_query,
        end: end.as_deref(),
        include: true,
    });
    let cursor = cursor.as_ref();
    // One lookahead row is enough to know whether continuation exists.
    let fetch_limit = plan.limit + 1;
    let mut hits = Vec::new();
    if let Some(prefix) = prefix.filter(|_| cursor.is_none_or(|key| key.tier == PageTier::Prefix)) {
        hits = fetch_page_tier(
            connection,
            &plan,
            verified_volumes,
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
                verified_volumes,
                outside_prefix,
                PageTier::Substring,
                after,
                remaining,
            )?;
        }
        hits.extend(substring_hits);
    }

    let has_more = hits.len() > plan.limit;
    hits.truncate(plan.limit);
    let next_cursor = hits
        .last()
        .filter(|_| has_more)
        .map(|last| {
            serde_json::to_string(&PageCursor {
                query: plan.normalized_query,
                tier: last.tier,
                name: last.hit.normalized_name.clone(),
                id: last.id,
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
    verified_volumes: &[(String, String)],
    prefix: Option<PrefixFilter<'_>>,
    tier: PageTier,
    after: Option<&PageCursor>,
    limit: usize,
) -> Result<Vec<PageHit>, String> {
    let fetch = |seek, limit: usize| {
        let (sql, params) = build_hits_sql(plan, verified_volumes, prefix, seek);
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
                hit: CatalogQueryHit {
                    path: row.get(0)?,
                    kind: int_to_kind(row.get(1)?),
                    normalized_name: row.get(2)?,
                },
                tier,
                id: row.get(3)?,
            })
        })
        .map_err(|error| format!("Failed to run indexed-search page: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read indexed-search page: {error}"))
}
