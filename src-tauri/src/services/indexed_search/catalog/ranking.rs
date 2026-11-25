// Ranking for indexed-search query hits.
//
// Ranking is separate from SQL construction so tuning search relevance stays
// easy to review. Ranks are precomputed before sorting so the comparator does
// not repeatedly scan filenames for every pairwise comparison.
use crate::domain::indexed_search::{IndexedEntryKind, IndexedPathMatch};

use super::{
    writer::{
        drive_root_from_catalog_path, entry_name_from_catalog_path, parent_path_from_catalog_path,
    },
    CatalogQueryHit, QueryPlan,
};

type HitRank = (u8, u8, usize, usize, usize);

struct RankedCatalogQueryHit {
    hit: CatalogQueryHit,
    rank: HitRank,
}

pub(super) fn rank_hits(hits: Vec<CatalogQueryHit>, plan: &QueryPlan) -> Vec<IndexedPathMatch> {
    let mut ranked_hits = hits
        .into_iter()
        .map(|hit| {
            let rank = build_hit_rank(&hit, plan);
            RankedCatalogQueryHit { hit, rank }
        })
        .collect::<Vec<_>>();

    ranked_hits.sort_by(|left, right| {
        left.rank
            .cmp(&right.rank)
            .then_with(|| left.hit.normalized_name.cmp(&right.hit.normalized_name))
            .then_with(|| left.hit.path.cmp(&right.hit.path))
    });
    ranked_hits.truncate(plan.limit);

    ranked_hits
        .into_iter()
        .map(|ranked_hit| ranked_hit.hit.into())
        .collect()
}

impl From<CatalogQueryHit> for IndexedPathMatch {
    fn from(hit: CatalogQueryHit) -> Self {
        let path = hit.path;
        Self {
            name: entry_name_from_catalog_path(&path),
            parent_path: parent_path_from_catalog_path(&path),
            drive_path: drive_root_from_catalog_path(&path),
            path,
            kind: hit.kind,
            size_bytes: hit.size_bytes,
        }
    }
}

fn build_hit_rank(hit: &CatalogQueryHit, plan: &QueryPlan) -> HitRank {
    let direct_match_rank = if !plan.has_wildcards && hit.normalized_name == plan.normalized_query {
        0
    } else if !plan.has_wildcards && hit.normalized_name.starts_with(&plan.normalized_query) {
        1
    } else {
        2
    };

    let position_score = if plan.plain_terms.is_empty() {
        0
    } else {
        plan.plain_terms.iter().fold(0usize, |score, term| {
            score.saturating_add(hit.normalized_name.find(term).unwrap_or(usize::MAX / 8))
        })
    };

    let kind_rank = match hit.kind {
        IndexedEntryKind::Directory => 0,
        IndexedEntryKind::File => 1,
    };

    (
        direct_match_rank,
        kind_rank,
        position_score,
        hit.normalized_name.len(),
        hit.path.len(),
    )
}
