// Indexed-search query planning and SQL construction.
//
// Query responsiveness matters more than cleverness here. The original
// `LIKE '%term%'` search path worked for small catalogs, but it degrades into
// broad table scans once the index grows. We use a trigram helper table to
// narrow candidate rows before final wildcard verification and ranking.
use std::collections::BTreeSet;

use rusqlite::{params, params_from_iter, types::Value};

use crate::domain::indexed_search::{IndexedPathMatch, IndexedPathQuery};

use super::{
    ranking::rank_hits, schema, writer::int_to_kind, CatalogQueryHit, DriveCatalogSnapshot,
    IndexedCatalogStore, QueryPlan,
};

const DEFAULT_QUERY_LIMIT: usize = 50;
const MAX_QUERY_LIMIT: usize = 100;
const MAX_FETCH_LIMIT: usize = 300;

impl IndexedCatalogStore {
    pub(in crate::services::indexed_search) fn query(
        &self,
        query: IndexedPathQuery,
    ) -> Result<Vec<IndexedPathMatch>, String> {
        let connection = self.connect()?;
        let helper_tokens_ready =
            schema::load_meta_bool(&connection, schema::SEARCH_TOKENS_READY_META_KEY)?
                .unwrap_or(false);
        let Some(plan) = build_query_plan(query, helper_tokens_ready) else {
            return Ok(Vec::new());
        };

        let sql = build_query_sql(plan.candidate_tokens.len(), plan.like_patterns.len());
        let mut params = plan
            .candidate_tokens
            .iter()
            .cloned()
            .map(Value::from)
            .collect::<Vec<_>>();
        params.extend(plan.like_patterns.iter().cloned().map(Value::from));
        params.push(Value::from(plan.fetch_limit as i64));

        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("Failed to prepare indexed-search query: {error}"))?;
        let hits = statement
            .query_map(params_from_iter(params.iter()), |row| {
                Ok(CatalogQueryHit {
                    path: row.get(0)?,
                    kind: int_to_kind(row.get(1)?),
                    normalized_name: row.get(2)?,
                })
            })
            .map_err(|error| format!("Failed to run indexed-search query: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Failed to read indexed-search results: {error}"))?;

        Ok(rank_hits(hits, &plan))
    }

    pub(in crate::services::indexed_search) fn load_ready_drive_snapshots(
        &self,
    ) -> Result<Vec<DriveCatalogSnapshot>, String> {
        let connection = self.connect()?;
        let mut statement = connection
            .prepare(
                "SELECT
                    drive.drive_path,
                    COALESCE(entries.entry_count, 0),
                    drive.last_scan_source,
                    drive.last_scan_completed_at
                 FROM indexed_drive_catalog_state drive
                 LEFT JOIN (
                    SELECT substr(path, 1, 3) AS drive_path, COUNT(*) AS entry_count
                    FROM indexed_entries
                    GROUP BY substr(path, 1, 3)
                 ) entries
                 ON entries.drive_path = drive.drive_path
                 WHERE drive.lifecycle_state = ?1",
            )
            .map_err(|error| {
                format!("Failed to prepare indexed-search drive snapshot query: {error}")
            })?;

        let rows = statement
            .query_map(params![schema::DRIVE_CATALOG_STATE_READY], |row| {
                Ok(DriveCatalogSnapshot {
                    drive_path: row.get(0)?,
                    entry_count: row.get::<_, i64>(1)?.max(0) as usize,
                    last_scan_source: row.get(2)?,
                    last_scan_completed_at: row.get(3)?,
                })
            })
            .map_err(|error| format!("Failed to read indexed-search drive snapshots: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Failed to collect indexed-search drive snapshots: {error}"))
    }
}

fn build_query_plan(query: IndexedPathQuery, helper_tokens_ready: bool) -> Option<QueryPlan> {
    let trimmed = query.query.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized_query = trimmed.to_lowercase();

    let mut plain_terms = Vec::new();
    let mut like_patterns = Vec::new();
    let mut candidate_tokens = BTreeSet::new();
    let mut has_wildcards = false;

    for token in trimmed.split_whitespace() {
        let normalized = token.to_lowercase();
        if normalized.is_empty() {
            continue;
        }

        let token_has_wildcards = normalized.contains('*') || normalized.contains('?');
        has_wildcards |= token_has_wildcards;
        if !token_has_wildcards {
            plain_terms.push(normalized.clone());
        }

        like_patterns.push(build_like_pattern(&normalized));

        if helper_tokens_ready {
            for segment in extract_literal_segments(&normalized) {
                if segment.chars().count() < 3 {
                    continue;
                }

                for trigram in collect_trigram_tokens(&segment) {
                    candidate_tokens.insert(trigram);
                }
            }
        }
    }

    if like_patterns.is_empty() {
        return None;
    }

    let limit = query
        .limit
        .unwrap_or(DEFAULT_QUERY_LIMIT)
        .clamp(1, MAX_QUERY_LIMIT);
    let fetch_limit = limit.saturating_mul(5).clamp(limit, MAX_FETCH_LIMIT);

    Some(QueryPlan {
        normalized_query,
        plain_terms,
        like_patterns,
        candidate_tokens: candidate_tokens.into_iter().collect(),
        limit,
        fetch_limit,
        has_wildcards,
    })
}

fn build_like_pattern(token: &str) -> String {
    let mut pattern = String::new();

    for character in token.chars() {
        match character {
            '*' => {
                pattern.push('%');
            }
            '?' => {
                pattern.push('_');
            }
            '%' | '_' | '\\' => {
                pattern.push('\\');
                pattern.push(character);
            }
            _ => pattern.push(character),
        }
    }

    // Indexed search is name-substring search by default. Wildcards should
    // refine the internal shape of that substring match, not silently anchor
    // the query to the whole filename.
    format!("%{pattern}%")
}

fn extract_literal_segments(pattern: &str) -> Vec<String> {
    pattern
        .split(['*', '?'])
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect()
}

pub(super) fn collect_search_tokens(name: &str) -> Vec<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    if trimmed.chars().count() < 3 {
        return vec![trimmed.to_string()];
    }

    collect_trigram_tokens(trimmed)
}

fn collect_trigram_tokens(value: &str) -> Vec<String> {
    let chars = value.chars().collect::<Vec<_>>();
    if chars.len() < 3 {
        return vec![value.to_string()];
    }

    let mut tokens = BTreeSet::new();
    for window in chars.windows(3) {
        tokens.insert(window.iter().collect::<String>());
    }

    tokens.into_iter().collect()
}

fn build_query_sql(candidate_token_count: usize, like_pattern_count: usize) -> String {
    let mut sql = String::new();

    if candidate_token_count > 0 {
        sql.push_str("WITH candidates AS (");
        sql.push_str("SELECT entry_id FROM indexed_entry_trigrams WHERE token IN (");
        for index in 0..candidate_token_count {
            if index > 0 {
                sql.push_str(", ");
            }
            sql.push_str(&format!("?{}", index + 1));
        }
        sql.push_str(") GROUP BY entry_id");
        sql.push_str(&format!(
            " HAVING COUNT(DISTINCT token) = {candidate_token_count}) "
        ));
        sql.push_str(
            "SELECT e.path, e.kind, e.normalized_name \
             FROM indexed_entries e \
             INNER JOIN candidates c ON c.entry_id = e.entry_id",
        );
    } else {
        sql.push_str(
            "SELECT e.path, e.kind, e.normalized_name \
             FROM indexed_entries e",
        );
    }

    if like_pattern_count > 0 {
        sql.push_str(" WHERE ");
        for index in 0..like_pattern_count {
            if index > 0 {
                sql.push_str(" AND ");
            }

            let param_index = candidate_token_count + index + 1;
            sql.push_str(&format!(
                "e.normalized_name LIKE ?{param_index} ESCAPE '\\'"
            ));
        }
    }

    let limit_index = candidate_token_count + like_pattern_count + 1;
    sql.push_str(" ORDER BY e.normalized_name ASC, e.path ASC");
    sql.push_str(&format!(" LIMIT ?{limit_index}"));
    sql
}
