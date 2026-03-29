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

#[derive(Clone, Copy)]
enum Segment<'a> {
    Digits {
        value: Option<u64>,
        len: usize,
        raw: &'a str,
    },
    Text(&'a str),
}

impl<'a> Segment<'a> {
    fn as_str(&self) -> &str {
        match self {
            Segment::Digits { raw, .. } => raw,
            Segment::Text(value) => value,
        }
    }
}

fn next_segment<'a>(value: &'a str, start: usize) -> (Segment<'a>, usize) {
    let mut iter = value[start..].char_indices();
    let (_first_offset, first_char) = iter
        .next()
        .map(|(offset, ch)| (offset, ch))
        .unwrap_or((0, '\0'));
    let is_digit = first_char.is_ascii_digit();
    let mut end = start + first_char.len_utf8();
    for (offset, ch) in iter {
        if ch.is_ascii_digit() != is_digit {
            break;
        }
        end = start + offset + ch.len_utf8();
    }
    let segment = &value[start..end];
    if is_digit {
        let parsed = segment.parse::<u64>().ok();
        (
            Segment::Digits {
                value: parsed,
                len: segment.len(),
                raw: segment,
            },
            end,
        )
    } else {
        (Segment::Text(segment), end)
    }
}

// Approximate Intl.Collator numeric + case-insensitive ordering from the UI.
fn natural_compare(left: &str, right: &str) -> Ordering {
    let mut left_index = 0;
    let mut right_index = 0;
    let left_len = left.len();
    let right_len = right.len();

    while left_index < left_len && right_index < right_len {
        let (left_segment, next_left) = next_segment(left, left_index);
        let (right_segment, next_right) = next_segment(right, right_index);
        left_index = next_left;
        right_index = next_right;

        let ordering = match (left_segment, right_segment) {
            (
                Segment::Digits {
                    value: left_value,
                    len: left_len,
                    raw: left_raw,
                },
                Segment::Digits {
                    value: right_value,
                    len: right_len,
                    raw: right_raw,
                },
            ) => match (left_value, right_value) {
                (Some(l), Some(r)) if l != r => l.cmp(&r),
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                _ => {
                    if left_len != right_len {
                        left_len.cmp(&right_len)
                    } else {
                        left_raw.cmp(right_raw)
                    }
                }
            },
            (Segment::Text(left_text), Segment::Text(right_text)) => left_text.cmp(right_text),
            (left_segment, right_segment) => left_segment.as_str().cmp(right_segment.as_str()),
        };

        if ordering != Ordering::Equal {
            return ordering;
        }
    }

    left_len.cmp(&right_len)
}

pub(super) fn compare_normalized_names(left: &str, right: &str) -> Ordering {
    natural_compare(left, right)
}

fn apply_sort_dir(ordering: Ordering, dir: SortDir) -> Ordering {
    match dir {
        SortDir::Asc => ordering,
        SortDir::Desc => ordering.reverse(),
    }
}

pub(super) struct EntrySortFields<'a> {
    pub is_dir: bool,
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

    match sort.key {
        SortKey::Name => {
            apply_sort_dir(compare_normalized_names(left.normalized_name, right.normalized_name), sort.dir)
        }
        SortKey::Size => {
            let size_order = compare_numbers(left.size, right.size);
            if size_order != Ordering::Equal {
                return apply_sort_dir(size_order, sort.dir);
            }
            compare_normalized_names(left.normalized_name, right.normalized_name)
        }
        SortKey::Modified => {
            let modified_order = compare_numbers(left.modified, right.modified);
            if modified_order != Ordering::Equal {
                return apply_sort_dir(modified_order, sort.dir);
            }
            compare_normalized_names(left.normalized_name, right.normalized_name)
        }
    }
}
