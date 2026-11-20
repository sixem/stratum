// Sorting helpers for directory listings and folder thumbnail sampling.
// These utilities keep name ordering behavior in one place.
use super::super::{SortDir, SortKey, SortState};
use std::cmp::Ordering;

pub(super) fn default_sort_state() -> SortState {
    SortState {
        key: SortKey::Name,
        dir: SortDir::Asc,
    }
}

pub(super) fn normalize_search(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_lowercase()
}

pub(super) fn normalize_name(value: &str) -> String {
    value.to_lowercase()
}

fn compare_numbers(a: Option<u64>, b: Option<u64>) -> Ordering {
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => left.cmp(&right),
    }
}

fn split_name_segment(value: &str, digits: bool) -> (&str, &str) {
    // All boundaries between ASCII digits and UTF-8 text are character boundaries.
    let end = value
        .bytes()
        .position(|byte| byte.is_ascii_digit() != digits)
        .unwrap_or(value.len());
    value.split_at(end)
}

fn compare_digit_segments(left: &str, right: &str) -> Ordering {
    let number_order = compare_numbers(left.parse::<u64>().ok(), right.parse::<u64>().ok());
    number_order
        .then_with(|| left.len().cmp(&right.len()))
        .then_with(|| left.cmp(right))
}

pub(super) fn compare_normalized_names(mut left: &str, mut right: &str) -> Ordering {
    while !left.is_empty() && !right.is_empty() {
        let first_left = left.as_bytes()[0];
        let first_right = right.as_bytes()[0];
        let digits = first_left.is_ascii_digit() && first_right.is_ascii_digit();
        if !digits && first_left != first_right {
            return first_left.cmp(&first_right);
        }
        let (left_segment, left_rest) = split_name_segment(left, digits);
        let (right_segment, right_rest) = split_name_segment(right, digits);
        if left_segment != right_segment {
            return if digits {
                compare_digit_segments(left_segment, right_segment)
            } else {
                left_segment.cmp(right_segment)
            };
        }
        left = left_rest;
        right = right_rest;
    }
    left.len().cmp(&right.len())
}

fn apply_sort_dir(ordering: Ordering, dir: SortDir) -> Ordering {
    match dir {
        SortDir::Asc => ordering,
        SortDir::Desc => ordering.reverse(),
    }
}

pub(super) struct EntrySortFields<'a> {
    pub is_dir: bool,
    pub name: &'a str,
    pub normalized_name: &'a str,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

// Keep folders first, then apply the requested sort with name fallbacks.
pub(super) fn compare_entry_fields(
    left: EntrySortFields<'_>,
    right: EntrySortFields<'_>,
    sort: &SortState,
) -> Ordering {
    if left.is_dir != right.is_dir {
        return if left.is_dir {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }

    let names = || {
        compare_normalized_names(left.normalized_name, right.normalized_name)
            .then_with(|| left.name.cmp(right.name))
    };
    match sort.key {
        SortKey::Name => apply_sort_dir(names(), sort.dir),
        SortKey::Size => {
            let size_order = compare_numbers(left.size, right.size);
            if size_order != Ordering::Equal {
                return apply_sort_dir(size_order, sort.dir);
            }
            names()
        }
        SortKey::Modified => {
            let modified_order = compare_numbers(left.modified, right.modified);
            if modified_order != Ordering::Equal {
                return apply_sort_dir(modified_order, sort.dir);
            }
            names()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_order_handles_numeric_runs_unicode_and_overflow() {
        let ordered = [
            "a",
            "a2",
            "a02",
            "a10",
            "a18446744073709551616",
            "aa2",
            "å2",
            "å10",
            "日本語1",
            "日本語20",
        ];
        for (index, left) in ordered.iter().enumerate() {
            for (other, right) in ordered.iter().enumerate() {
                assert_eq!(compare_normalized_names(left, right), index.cmp(&other));
            }
        }
    }

    #[test]
    fn equal_metadata_keeps_natural_name_order_and_breaks_case_ties() {
        let fields = |name| EntrySortFields {
            is_dir: false,
            name,
            normalized_name: "file",
            size: Some(1),
            modified: Some(5),
        };
        for key in [SortKey::Size, SortKey::Modified] {
            let sort = SortState {
                key,
                dir: SortDir::Desc,
            };
            assert_eq!(
                compare_entry_fields(fields("FILE"), fields("file"), &sort),
                Ordering::Less
            );
        }
        let sort = SortState {
            key: SortKey::Name,
            dir: SortDir::Desc,
        };
        assert_eq!(
            compare_entry_fields(fields("FILE"), fields("file"), &sort),
            Ordering::Greater
        );
    }
}
