// Indexed-search query planning and SQL construction.
//
// FTS supplies candidate row IDs. SQLite's LIKE still verifies wildcard
// patterns on the original names before results are ranked.
use std::{borrow::Cow, collections::BTreeSet};

use rusqlite::{
    functions::FunctionFlags, params, params_from_iter, types::Value, Connection, OptionalExtension,
};

use crate::domain::{
    file_search::{FileSearch, FileSearchFilters},
    indexed_search::{IndexedEntryKind, IndexedFolderScope, IndexedPathMatch, IndexedPathQuery},
};

use super::{
    ranking::rank_hits,
    schema, search_index,
    writer::{int_to_kind, kind_to_int},
    CatalogQueryHit, DriveCatalogSnapshot, IndexedCatalogStore, JournalCheckpoint, QueryPlan,
};

const MAX_FETCH_LIMIT: usize = 300;
const MAX_FTS_TERMS: usize = 64;
const SELECT_HIT_COLUMNS: &str =
    "SELECT e.path, e.kind, e.normalized_name, e.entry_id, e.size_bytes";

#[derive(Clone, Copy)]
pub(super) struct PrefixFilter<'a> {
    pub(super) start: &'a str,
    pub(super) end: Option<&'a str>,
    pub(super) include: bool,
}

pub(super) enum NameSeek<'a> {
    EqualNameAfterId(&'a str, i64),
    AfterName(&'a str),
    AfterKey(&'a str, i64),
}

pub(super) struct FolderPathPlan {
    pub(super) normalized_query: String,
    drive: Option<char>,
    anchored: bool,
    parents: Vec<String>,
    name_prefix: String,
}

impl FolderPathPlan {
    pub(super) fn parse(search: &str) -> Option<Self> {
        let search = search.trim();
        if !search.contains(['\\', '/']) && drive_letter(search).is_none() {
            return None;
        }
        let search = search.replace('/', "\\");
        let search = if let Some(path) = search.strip_prefix(r"\\?\") {
            drive_letter(path)?;
            path
        } else {
            &search
        };
        if search.starts_with(r"\\") {
            return None;
        }
        let drive = drive_letter(search);
        let relative = if drive.is_some() {
            &search[2..]
        } else {
            search
        };
        let anchored = drive.is_some() || relative.starts_with('\\');
        let mut parents: Vec<_> = relative
            .split('\\')
            .filter(|part| !part.is_empty())
            .map(str::to_lowercase)
            .collect();
        let name_prefix = if relative.ends_with('\\') {
            String::new()
        } else {
            parents.pop().unwrap_or_default()
        };
        Some(Self {
            normalized_query: search.to_lowercase(),
            drive,
            anchored,
            parents,
            name_prefix,
        })
    }

    fn matches_parent(&self, path: &str) -> bool {
        let Some(relative) = path.get(3..) else {
            return false;
        };
        let mut components = relative.trim_end_matches('\\').rsplit('\\').skip(1);
        self.parents.iter().rev().all(|expected| {
            components.next().is_some_and(|actual| {
                actual.eq_ignore_ascii_case(expected)
                    || (!actual.is_ascii() && actual.to_lowercase() == *expected)
            })
        }) && (!self.anchored || components.next().is_none())
    }
}

fn drive_letter(path: &str) -> Option<char> {
    match path.as_bytes() {
        [letter, b':', ..] if letter.is_ascii_alphabetic() => Some(*letter as char),
        _ => None,
    }
}

pub(super) fn build_folder_path_sql(
    connection: &Connection,
    plan: FolderPathPlan,
    verified_volumes: &[(String, String)],
    scope: &IndexedFolderScope,
    after: Option<(&str, i64)>,
) -> Result<(String, Vec<Value>), String> {
    let mut sql = format!("{SELECT_HIT_COLUMNS} FROM indexed_entries e WHERE 1 = 1");
    let mut params = Vec::new();
    append_folder_filter(&mut sql, &mut params, Some(scope));
    if let Some(letter) = plan.drive {
        // The catalog's binary path index can seek into both possible letter spellings.
        sql.push_str(" AND ((e.path >= ? AND e.path < ?) OR (e.path >= ? AND e.path < ?))");
        for letter in [letter.to_ascii_uppercase(), letter.to_ascii_lowercase()] {
            params.extend([format!("{letter}:\\").into(), format!("{letter}:]").into()]);
        }
    }
    if let Some((name, id)) = after {
        sql.push_str(" AND (e.normalized_name, e.entry_id) > (?, ?)");
        params.extend([Value::from(name.to_owned()), Value::from(id)]);
    }
    if !plan.name_prefix.is_empty() {
        let end = exclusive_prefix_end(&plan.name_prefix);
        append_prefix_filter(
            &mut sql,
            &mut params,
            "e.normalized_name",
            Some(PrefixFilter {
                start: &plan.name_prefix,
                end: end.as_deref(),
                include: true,
            }),
        );
    }
    append_verified_volumes_filter(&mut sql, &mut params, verified_volumes);

    // SQLite's NOCASE handles ASCII only. Keep the existing Unicode basename
    // range and compare the remaining complete path components in the same SQL read.
    connection
        .create_scalar_function(
            "stratum_folder_parent_matches",
            1,
            FunctionFlags::SQLITE_DETERMINISTIC,
            move |context| {
                let path = context.get_raw(0).as_str()?;
                Ok(plan.matches_parent(path))
            },
        )
        .map_err(|error| format!("Failed to prepare folder-path matching: {error}"))?;
    sql.push_str(" AND stratum_folder_parent_matches(e.path)");
    Ok((sql, params))
}

impl IndexedCatalogStore {
    pub(in crate::services::indexed_search) fn query(
        &self,
        query: IndexedPathQuery,
        verified_volumes: &[(String, String)],
    ) -> Result<Vec<IndexedPathMatch>, String> {
        if verified_volumes.is_empty() {
            return Ok(Vec::new());
        }
        let mut connection = self.connect()?;
        // Use the same SQLite read snapshot for both candidate tiers, even
        // when a volume rebuild publishes a replacement during the query.
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Failed to start indexed-search query: {error}"))?;
        let fts_ready = !search_index::needs_backfill(&transaction)?;
        let Some(plan) = build_query_plan(query, fts_ready, true) else {
            return Ok(Vec::new());
        };
        register_file_type_filter(&transaction, &plan)?;

        let prefix_end = exclusive_prefix_end(&plan.normalized_query);
        let prefix = plan.prefix_filter(prefix_end.as_deref());
        // Reserve candidate slots for exact and prefix matches before an
        // alphabetically earlier substring can consume the candidate budget.
        let mut hits = Vec::new();
        if let Some(prefix) = prefix {
            hits = fetch_hits(
                &transaction,
                &plan,
                verified_volumes,
                Some(prefix),
                plan.fetch_limit,
            )?;
        }
        if hits.len() < plan.limit {
            let remaining = plan.fetch_limit - hits.len();
            let outside_prefix = prefix.map(|prefix| PrefixFilter {
                include: false,
                ..prefix
            });
            hits.extend(fetch_hits(
                &transaction,
                &plan,
                verified_volumes,
                outside_prefix,
                remaining,
            )?);
        }

        Ok(rank_hits(hits, &plan))
    }

    pub(in crate::services::indexed_search) fn load_ready_drive_snapshots(
        &self,
    ) -> Result<Vec<DriveCatalogSnapshot>, String> {
        let connection = self.connect()?;
        let mut statement = connection
            // Opening the saved index needs only its durable volume headers.
            // A legacy header can omit its count until the worker backfills it.
            .prepare(
                "SELECT
                    drive.drive_path,
                    drive.saved_entry_count,
                    drive.last_scan_source,
                    drive.last_scan_completed_at,
                    drive.volume_id,
                    drive.journal_id,
                    drive.journal_next_usn,
                    EXISTS (SELECT 1 FROM indexed_pending_renames pending
                            WHERE pending.drive_path = drive.drive_path)
                 FROM indexed_drive_catalog_state drive
                 WHERE drive.lifecycle_state = ?1",
            )
            .map_err(|error| {
                format!("Failed to prepare indexed-search drive snapshot query: {error}")
            })?;

        let rows = statement
            .query_map(params![schema::DRIVE_CATALOG_STATE_READY], |row| {
                let journal_id: Option<i64> = row.get(5)?;
                let next_usn: Option<i64> = row.get(6)?;
                let journal_checkpoint =
                    journal_id
                        .zip(next_usn)
                        .map(|(journal_id, next_usn)| JournalCheckpoint {
                            journal_id: journal_id as u64,
                            next_usn,
                        });
                Ok(DriveCatalogSnapshot {
                    drive_path: row.get(0)?,
                    volume_id: row.get(4)?,
                    journal_checkpoint,
                    pending_renames: row.get(7)?,
                    entry_count: row.get(1)?,
                    last_scan_source: row.get(2)?,
                    last_scan_completed_at: row.get(3)?,
                })
            })
            .map_err(|error| format!("Failed to read indexed-search drive snapshots: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Failed to collect indexed-search drive snapshots: {error}"))
    }

    pub(in crate::services::indexed_search) fn refresh_ready_drive_count(
        &self,
        snapshot: &DriveCatalogSnapshot,
    ) -> Result<Option<usize>, String> {
        let Some(volume_id) = snapshot.volume_id.as_deref() else {
            return Ok(None);
        };
        let connection = self.connect()?;
        let count = count_ready_drive_entries(&connection, snapshot, volume_id)?;
        if let Some(count) = count {
            connection
                .execute(
                    "UPDATE indexed_drive_catalog_state SET saved_entry_count = ?5
                 WHERE drive_path = ?1 AND volume_id = ?2 AND lifecycle_state = ?3
                   AND last_scan_completed_at IS ?4 AND saved_entry_count IS NOT ?5",
                    params![
                        snapshot.drive_path,
                        volume_id,
                        schema::DRIVE_CATALOG_STATE_READY,
                        snapshot.last_scan_completed_at,
                        count
                    ],
                )
                .map_err(|error| {
                    format!(
                        "Failed to save indexed path count for {}: {error}",
                        snapshot.drive_path
                    )
                })?;
        }
        Ok(count)
    }

    #[cfg(test)]
    pub(in crate::services::indexed_search) fn read_ready_drive_count(
        &self,
        snapshot: &DriveCatalogSnapshot,
    ) -> Result<Option<usize>, String> {
        let Some(volume_id) = snapshot.volume_id.as_deref() else {
            return Ok(None);
        };
        count_ready_drive_entries(&self.connect()?, snapshot, volume_id)
    }
}

fn count_ready_drive_entries(
    connection: &Connection,
    snapshot: &DriveCatalogSnapshot,
    volume_id: &str,
) -> Result<Option<usize>, String> {
    // Use indexed seeks for both drive-letter spellings within one
    // verified snapshot. This work never gates search or volume checks.
    connection
        .query_row(
            "SELECT
            (SELECT COUNT(*) FROM indexed_entries
             WHERE path >= upper(drive.drive_path)
               AND path < substr(upper(drive.drive_path), 1, 2) || ']')
            + (SELECT COUNT(*) FROM indexed_entries
               WHERE path >= lower(drive.drive_path)
                 AND path < substr(lower(drive.drive_path), 1, 2) || ']')
         FROM indexed_drive_catalog_state drive
         WHERE drive.drive_path = ?1 AND drive.volume_id = ?2
           AND drive.lifecycle_state = ?3 AND drive.last_scan_completed_at IS ?4",
            params![
                snapshot.drive_path,
                volume_id,
                schema::DRIVE_CATALOG_STATE_READY,
                snapshot.last_scan_completed_at
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| {
            format!(
                "Failed to count indexed paths for {}: {error}",
                snapshot.drive_path
            )
        })
}

fn fetch_hits(
    connection: &Connection,
    plan: &QueryPlan,
    verified_volumes: &[(String, String)],
    prefix: Option<PrefixFilter<'_>>,
    limit: usize,
) -> Result<Vec<CatalogQueryHit>, String> {
    let (mut sql, mut params) = build_hits_sql(plan, verified_volumes, prefix, None, None);
    sql.push_str(" ORDER BY e.normalized_name ASC, e.path ASC LIMIT ?");
    params.push(Value::from(limit as i64));

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("Failed to prepare indexed-search query: {error}"))?;
    let rows = statement
        .query_map(params_from_iter(params.iter()), CatalogQueryHit::read)
        .map_err(|error| format!("Failed to run indexed-search query: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read indexed-search results: {error}"))
}

pub(super) fn build_hits_sql(
    plan: &QueryPlan,
    verified_volumes: &[(String, String)],
    prefix: Option<PrefixFilter<'_>>,
    seek: Option<NameSeek<'_>>,
    folder_scope: Option<&IndexedFolderScope>,
) -> (String, Vec<Value>) {
    // The prefix range can use the name index, including for one-character
    // searches and catalogs whose FTS backfill has not finished yet.
    let match_expression = plan
        .match_expression
        .as_ref()
        .filter(|_| !prefix.is_some_and(|filter| filter.include));
    let mut sql = String::from(SELECT_HIT_COLUMNS);
    if match_expression.is_some() {
        // Start with the FTS row IDs before looking up the entries.
        sql.push_str(
            " FROM indexed_entry_fts CROSS JOIN indexed_entries e ON e.entry_id = indexed_entry_fts.rowid
              WHERE indexed_entry_fts MATCH ?",
        );
    } else {
        sql.push_str(" FROM indexed_entries e WHERE 1");
    }
    let mut params = match_expression
        .into_iter()
        .cloned()
        .map(Value::from)
        .collect::<Vec<_>>();
    append_match_filters(
        &mut sql,
        &mut params,
        "e.normalized_name",
        plan,
        verified_volumes,
    );
    // SQLite uses the first applicable lower name bound as its index start.
    // Put the continuation bound ahead of the beginning of the prefix range.
    match seek {
        Some(NameSeek::EqualNameAfterId(name, id)) => {
            sql.push_str(" AND e.normalized_name = ? AND e.entry_id > ?");
            params.extend([Value::from(name.to_owned()), Value::from(id)]);
        }
        Some(NameSeek::AfterName(name)) => {
            sql.push_str(" AND e.normalized_name > ?");
            params.push(Value::from(name.to_owned()));
        }
        Some(NameSeek::AfterKey(name, id)) => {
            sql.push_str(" AND (e.normalized_name, e.entry_id) > (?, ?)");
            params.extend([Value::from(name.to_owned()), Value::from(id)]);
        }
        None => {}
    }
    append_prefix_filter(&mut sql, &mut params, "e.normalized_name", prefix);
    append_folder_filter(&mut sql, &mut params, folder_scope);
    (sql, params)
}

pub(super) fn build_ordered_substring_probe_sql(
    plan: &QueryPlan,
    verified_volumes: &[(String, String)],
    prefix: Option<PrefixFilter<'_>>,
    after: Option<(&str, i64)>,
    candidate_limit: usize,
    folder_scope: Option<&IndexedFolderScope>,
) -> (String, Vec<Value>) {
    // Materialize the name window before applying LIKE. This bounds the
    // probe even if none of the candidates match or belong to a ready drive.
    // Name and row ID are covered by this index. Only matching names need a
    // table lookup for the path, kind, and drive verification.
    let source = "SELECT e.normalized_name, e.entry_id
                  FROM indexed_entries e INDEXED BY indexed_entries_normalized_name_idx";
    let order = "ORDER BY e.normalized_name, e.entry_id";
    let cap = candidate_limit as i64;
    let (mut sql, mut params) = if let Some((name, id)) = after {
        // Seek past exact-name ties by row ID, then spend what remains of the
        // same window on later names. A tuple seek can reread earlier ties.
        (
            format!(
                "WITH tied AS MATERIALIZED (
                   {source} WHERE e.normalized_name = ? AND e.entry_id > ? {order} LIMIT ?
                 ), later AS MATERIALIZED (
                   {source} WHERE e.normalized_name > ? {order} LIMIT ? - (SELECT count(*) FROM tied)
                 ), ordered AS (SELECT * FROM tied UNION ALL SELECT * FROM later)"
            ),
            vec![name.to_owned().into(), id.into(), cap.into(), name.to_owned().into(), cap.into()],
        )
    } else {
        (
            format!("WITH ordered AS MATERIALIZED ({source} {order} LIMIT ?)"),
            vec![cap.into()],
        )
    };
    sql.push(' ');
    sql.push_str(SELECT_HIT_COLUMNS);
    sql.push_str(
        " FROM ordered candidate CROSS JOIN indexed_entries e ON e.entry_id = candidate.entry_id WHERE 1",
    );
    append_match_filters(
        &mut sql,
        &mut params,
        "candidate.normalized_name",
        plan,
        verified_volumes,
    );
    append_prefix_filter(&mut sql, &mut params, "candidate.normalized_name", prefix);
    append_folder_filter(&mut sql, &mut params, folder_scope);
    (sql, params)
}

fn append_folder_filter(
    sql: &mut String,
    params: &mut Vec<Value>,
    scope: Option<&IndexedFolderScope>,
) {
    let Some(scope) = scope else {
        return;
    };
    sql.push_str(" AND e.kind = ? AND length(e.path) > 3");
    params.push(Value::from(kind_to_int(IndexedEntryKind::Directory)));
    // In a catalog path C:\\name, each separator marks a level below the root.
    // Strip trailing separators first so an equivalent folder spelling has the same depth.
    if let Some(depth) = scope.max_depth {
        sql.push_str(
            " AND length(rtrim(e.path, char(92))) - length(replace(rtrim(e.path, char(92)), char(92), '')) <= ?",
        );
        params.push(Value::from(i64::try_from(depth).unwrap_or(i64::MAX)));
    }
}

fn append_prefix_filter(
    sql: &mut String,
    params: &mut Vec<Value>,
    name_column: &str,
    prefix: Option<PrefixFilter<'_>>,
) {
    if let Some(filter) = prefix {
        sql.push_str(if filter.include {
            " AND ("
        } else {
            " AND NOT ("
        });
        sql.push_str(name_column);
        sql.push_str(" >= ?");
        params.push(Value::from(filter.start.to_owned()));
        if let Some(end) = filter.end {
            sql.push_str(" AND ");
            sql.push_str(name_column);
            sql.push_str(" < ?");
            params.push(Value::from(end.to_owned()));
        }
        sql.push(')');
    }
}

// SQLite's binary UTF-8 ordering preserves Unicode scalar order. Increment
// the last scalar that has a successor, dropping any maximum scalars after it.
pub(super) fn exclusive_prefix_end(prefix: &str) -> Option<String> {
    let (offset, next) = prefix
        .char_indices()
        .rev()
        .find_map(|(offset, character)| {
            let successor = if character == '\u{d7ff}' {
                Some('\u{e000}')
            } else {
                char::from_u32(u32::from(character) + 1)
            };
            successor.map(|next| (offset, next))
        })?;
    Some(format!("{}{next}", &prefix[..offset]))
}

pub(super) fn build_query_plan(
    query: IndexedPathQuery,
    fts_ready: bool,
    parse_file_filters: bool,
) -> Option<QueryPlan> {
    let FileSearch {
        name_query,
        filters,
    } = if parse_file_filters {
        FileSearch::parse(&query.query)
    } else {
        FileSearch {
            name_query: Cow::Borrowed(&query.query),
            filters: FileSearchFilters::default(),
        }
    };
    let filters = filters.has_filters().then_some(filters);
    let trimmed = name_query.trim();
    if trimmed.is_empty() && filters.is_none() {
        return None;
    }

    let normalized_query = trimmed.to_lowercase();

    let mut plain_terms = Vec::new();
    let mut like_patterns = Vec::new();
    let mut candidate_tokens = BTreeSet::new();
    let mut has_wildcards = false;
    // SQLite's LIKE treats NUL specially, so keep its behavior for NUL queries
    // by skipping FTS as well as for short and wildcard-only terms.
    let can_use_fts = fts_ready && !trimmed.contains('\0');

    for token in trimmed.split_whitespace() {
        let normalized = token.to_lowercase();

        let token_has_wildcards = normalized.contains('*') || normalized.contains('?');
        has_wildcards |= token_has_wildcards;
        if !token_has_wildcards {
            plain_terms.push(normalized.clone());
        }

        like_patterns.push(build_like_pattern(&normalized));

        if can_use_fts && candidate_tokens.len() < MAX_FTS_TERMS {
            collect_candidate_tokens(&normalized, &mut candidate_tokens);
        }
    }

    let limit = query.effective_limit();
    let fetch_limit = limit.saturating_mul(5).clamp(limit, MAX_FETCH_LIMIT);

    Some(QueryPlan {
        normalized_query,
        filters,
        plain_terms,
        like_patterns,
        match_expression: build_match_expression(candidate_tokens),
        limit,
        fetch_limit,
        has_wildcards,
    })
}

impl QueryPlan {
    pub(super) fn prefix_filter<'a>(&'a self, end: Option<&'a str>) -> Option<PrefixFilter<'a>> {
        (!self.has_wildcards && !self.normalized_query.is_empty()).then_some(PrefixFilter {
            start: &self.normalized_query,
            end,
            include: true,
        })
    }
}

pub(super) fn register_file_type_filter(
    connection: &Connection,
    plan: &QueryPlan,
) -> Result<(), String> {
    let Some(filters) = plan
        .filters
        .as_ref()
        .filter(|filters| !filters.file_types.is_empty())
    else {
        return Ok(());
    };
    let filters = filters.clone();
    connection
        .create_scalar_function(
            "stratum_matches_file_type",
            2,
            FunctionFlags::SQLITE_DETERMINISTIC,
            move |context| {
                let name = context.get_raw(0).as_str()?;
                let is_dir =
                    int_to_kind(context.get_raw(1).as_i64()?) == IndexedEntryKind::Directory;
                Ok(filters.matches_type(name, is_dir))
            },
        )
        .map_err(|error| format!("Failed to prepare indexed-search file type filter: {error}"))
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

fn collect_candidate_tokens(pattern: &str, tokens: &mut BTreeSet<String>) {
    // Detail-free FTS accepts single trigrams. A bounded subset is sufficient
    // to filter candidates because LIKE still checks the whole pattern.
    for segment in pattern.split(['*', '?']) {
        let mut characters = segment.chars();
        let (Some(mut first), Some(mut second)) = (characters.next(), characters.next()) else {
            continue;
        };
        for third in characters {
            tokens.insert([first, second, third].into_iter().collect::<String>());
            if tokens.len() == MAX_FTS_TERMS {
                return;
            }
            first = second;
            second = third;
        }
    }
}

fn build_match_expression(tokens: BTreeSet<String>) -> Option<String> {
    if tokens.is_empty() {
        return None;
    }

    // Quote each trigram as a literal so quotes and FTS operators typed in
    // the search box are never interpreted as query operators.
    let terms = tokens
        .into_iter()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    Some(terms.join(" AND "))
}

fn append_match_filters(
    sql: &mut String,
    params: &mut Vec<Value>,
    name_column: &str,
    plan: &QueryPlan,
    verified_volumes: &[(String, String)],
) {
    for pattern in &plan.like_patterns {
        sql.push_str(" AND ");
        sql.push_str(name_column);
        sql.push_str(" LIKE ? ESCAPE '\\'");
        params.push(Value::from(pattern.clone()));
    }
    append_verified_volumes_filter(sql, params, verified_volumes);
    if let Some(filters) = &plan.filters {
        // NULL sizes naturally fail comparisons. The catalog leaves folder sizes unknown.
        if let Some(min) = filters.min_size {
            sql.push_str(" AND e.size_bytes >= ?");
            params.push(Value::Integer(i64::try_from(min).unwrap_or(i64::MAX)));
        }
        if let Some(max) = filters.max_size {
            sql.push_str(" AND e.size_bytes <= ?");
            params.push(Value::Integer(i64::try_from(max).unwrap_or(i64::MAX)));
        }
        if !filters.file_types.is_empty() {
            sql.push_str(" AND stratum_matches_file_type(e.normalized_name, e.kind)");
        }
    }
}

fn append_verified_volumes_filter(
    sql: &mut String,
    params: &mut Vec<Value>,
    verified_volumes: &[(String, String)],
) {
    // Apply the mount and ready-snapshot checks before LIMIT so stale rows
    // cannot occupy result slots, and verify each identity in this SQL read.
    sql.push_str(
        " AND substr(e.path, 1, 3) COLLATE NOCASE IN (
            SELECT drive_path FROM indexed_drive_catalog_state
            WHERE lifecycle_state = ? AND (drive_path, volume_id) IN (VALUES ",
    );
    params.push(Value::from(schema::DRIVE_CATALOG_STATE_READY.to_string()));
    for (index, (drive_path, volume_id)) in verified_volumes.iter().enumerate() {
        if index > 0 {
            sql.push_str(", ");
        }
        sql.push_str("(?, ?)");
        params.push(Value::from(drive_path.clone()));
        params.push(Value::from(volume_id.clone()));
    }
    sql.push_str("))");
}
