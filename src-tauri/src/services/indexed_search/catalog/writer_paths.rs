// Reconcile paths through the catalog's existing binary path index.
#[cfg(windows)]
use std::collections::BTreeMap;
use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Statement};

#[cfg(windows)]
use super::{int_to_kind, IndexedEntryKind};
use super::{kind_to_int, trim_catalog_path, CatalogEntryRecord};

pub(super) const DELETE_PATH_TREE: &str =
    "DELETE FROM indexed_entries WHERE path = ?1 OR (path >= ?2 AND path < ?3)";
pub(super) const SEEK_PATH: &str =
    "SELECT path FROM indexed_entries WHERE path >= ? ORDER BY path LIMIT 1";
pub(super) const FIND_PATH_TREE: &str =
    "SELECT 1 FROM indexed_entries WHERE path = ?1 OR (path >= ?2 AND path < ?3) LIMIT 1";
pub(super) const READ_PATH_TREE: &str = "SELECT path, normalized_name, kind FROM indexed_entries
                                       WHERE path = ?1 OR (path >= ?2 AND path < ?3) LIMIT ?4";
const MAX_CASE_PROBE_SEEKS: usize = 64;

#[cfg(windows)]
pub(super) fn indexed_children(
    connection: &Connection,
    parent: &str,
) -> Result<BTreeMap<String, Option<IndexedEntryKind>>, String> {
    let read = || -> rusqlite::Result<_> {
        let mut seek = connection.prepare_cached(
            "SELECT path, kind FROM indexed_entries
             WHERE path >= ?1 AND path < ?2 ORDER BY path LIMIT 1",
        )?;
        let mut children = BTreeMap::new();
        let parent = trim_catalog_path(parent);
        for spelling in drive_spellings(parent) {
            let prefix = format!("{}\\", spelling.trim_end_matches('\\'));
            let end = format!("{}]", spelling.trim_end_matches('\\'));
            let mut start = prefix.clone();
            while let Some((path, kind)) = seek
                .query_row(params![start, end], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .optional()?
            {
                let relative = &path[prefix.len()..];
                if let Some((name, _)) = relative.split_once('\\') {
                    // Jump over this subtree without walking its descendants.
                    children.entry(name.to_owned()).or_insert(None);
                    start = format!("{prefix}{name}]");
                } else {
                    children.insert(relative.to_owned(), Some(int_to_kind(kind)));
                    // A NUL follows the exact filename and precedes every
                    // possible continuation of that name in the binary index.
                    start = format!("{path}\0");
                }
            }
        }
        Ok(children)
    };
    read().map_err(|error| format!("Failed to read indexed-search direct children: {error}"))
}

#[cfg(windows)]
pub(super) fn remove_exact_path_tree(connection: &Connection, path: &str) -> Result<usize, String> {
    let path = validated_path_tree(path)?;
    let delete = || -> rusqlite::Result<usize> {
        let mut statement = connection.prepare_cached(DELETE_PATH_TREE)?;
        let mut removed = 0;
        for path in drive_spellings(path) {
            let (first_child, after_children) = path_tree_bounds(&path);
            removed += statement.execute(params![path, first_child, after_children])?;
        }
        Ok(removed)
    };
    delete().map_err(|error| format!("Failed to remove indexed-search subtree: {error}"))
}

// Compare the rows a watcher would replace, including the drive spelling.
// The read is bounded even if a directory grew beyond the watcher budget.
pub(super) fn bounded_tree_differs(
    connection: &Connection,
    path: &str,
    replacement: &[CatalogEntryRecord],
    limit: usize,
) -> Result<bool, String> {
    let path = validated_path_tree(path)?;
    if replacement.len() > limit {
        return Ok(false);
    }
    let expected: HashMap<_, _> = replacement
        .iter()
        .map(|record| (record.path.as_str(), record))
        .collect();
    let compare = || -> rusqlite::Result<bool> {
        let mut select = connection.prepare_cached(READ_PATH_TREE)?;
        let mut count = 0;
        let mut changed = false;
        for spelling in drive_spellings(path) {
            let (first_child, after_children) = path_tree_bounds(&spelling);
            let mut rows = select.query(params![
                spelling,
                first_child,
                after_children,
                limit - count + 1
            ])?;
            while let Some(row) = rows.next()? {
                count += 1;
                if count > limit {
                    return Ok(false);
                }
                let path = row.get_ref(0)?.as_str().ok();
                let name = row.get_ref(1)?.as_str().ok();
                let kind: i64 = row.get(2)?;
                let same = path
                    .and_then(|path| expected.get(path))
                    .is_some_and(|record| {
                        name == Some(record.normalized_name.as_str())
                            && kind == kind_to_int(record.kind)
                    });
                changed |= !same;
            }
        }
        Ok(changed || count != replacement.len())
    };
    compare().map_err(|error| format!("Failed to compare indexed-search path {path}: {error}"))
}

pub(super) fn remove_path_trees(
    connection: &Connection,
    paths: &[String],
    mut row_budget: Option<usize>,
) -> Result<bool, String> {
    if paths.is_empty() {
        return Ok(true);
    }
    let mut delete = connection
        .prepare_cached(DELETE_PATH_TREE)
        .map_err(|error| format!("Failed to prepare indexed-search delete: {error}"))?;

    for path in paths {
        let path = validated_path_tree(path)?;

        let mut removed = 0;
        for path in drive_spellings(path) {
            let (first_child, after_children) = path_tree_bounds(&path);
            if let Some(remaining) = &mut row_budget {
                let rows = connection
                    .query_row(
                        "SELECT count(*) FROM (
                            SELECT 1 FROM indexed_entries
                            WHERE path = ?1 OR (path >= ?2 AND path < ?3) LIMIT ?4
                        )",
                        params![path, first_child, after_children, *remaining + 1],
                        |row| row.get::<_, usize>(0),
                    )
                    .map_err(|error| format!("Failed to bound indexed-search deletion: {error}"))?;
                let Some(left) = remaining.checked_sub(rows) else {
                    return Ok(false);
                };
                *remaining = left;
            }
            removed += delete
                .execute(params![path, first_child, after_children])
                .map_err(|error| {
                    format!("Failed to remove indexed-search entries for {path}: {error}")
                })?;
        }
        if removed == 0 && needs_case_check(connection, path)? {
            // A different spelling could represent a distinct item in a
            // case-sensitive directory. Leave it to a physical volume scan.
            return Ok(false);
        }
    }
    Ok(true)
}

fn validated_path_tree(path: &str) -> Result<&str, String> {
    let path = trim_catalog_path(path);
    match path.as_bytes() {
        [letter, b':', b'\\', rest @ ..] if letter.is_ascii_alphabetic() && !rest.is_empty() => {
            Ok(path)
        }
        _ => Err(format!(
            "Cannot reconcile indexed-search path {path}: expected an entry below a drive root."
        )),
    }
}

fn path_tree_bounds(path: &str) -> (String, String) {
    // ']' follows '\\' in ASCII. These bounds cover all descendants
    // and exclude siblings, even for literal '%' and '_'.
    (format!("{path}\\"), format!("{path}]"))
}

fn needs_case_check(connection: &Connection, path: &str) -> Result<bool, String> {
    let check = || -> rusqlite::Result<bool> {
        let mut seek = connection.prepare_cached(SEEK_PATH)?;
        let mut remaining_seeks = MAX_CASE_PROBE_SEEKS;
        if has_case_alias(&mut seek, path, &mut remaining_seeks)? {
            return Ok(true);
        }

        // A new leaf can have no indexed spelling of its own. Find the
        // nearest indexed ancestor before accepting the new spelling.
        let mut find_tree = connection.prepare_cached(FIND_PATH_TREE)?;
        for (end, _) in path.rmatch_indices('\\').take_while(|(end, _)| *end > 2) {
            let ancestor = &path[..end];
            for prefix in drive_spellings(ancestor) {
                if find_tree.exists(params![prefix, format!("{prefix}\\"), format!("{prefix}]")])? {
                    return Ok(false);
                }
            }
            if has_case_alias(&mut seek, ancestor, &mut remaining_seeks)? {
                return Ok(true);
            }
        }
        Ok(false)
    };
    check()
        .map_err(|error| format!("Failed to check indexed-search path casing for {path}: {error}"))
}

fn drive_spellings(path: &str) -> [String; 2] {
    let letter = path.as_bytes()[0];
    [letter.to_ascii_uppercase(), letter.to_ascii_lowercase()]
        .map(|letter| format!("{}{}", char::from(letter), &path[1..]))
}

fn has_case_alias(
    seek: &mut Statement<'_>,
    path: &str,
    remaining_seeks: &mut usize,
) -> rusqlite::Result<bool> {
    let mut start = path.to_ascii_uppercase();
    let last = path.to_ascii_lowercase();
    while *remaining_seeks > 0 {
        *remaining_seeks -= 1;
        let Some(found) = seek
            .query_row([&start], |row| row.get::<_, String>(0))
            .optional()?
        else {
            return Ok(false);
        };
        if let Some(prefix) = found.get(..path.len()) {
            if prefix.eq_ignore_ascii_case(path) {
                match found.as_bytes().get(path.len()) {
                    None | Some(b'\\') => return Ok(true),
                    Some(&next) if next < b'\\' => {
                        // Skip a sibling such as "folder-old" and check
                        // the "folder\\" range for this same spelling.
                        start = format!("{prefix}\\");
                        continue;
                    }
                    _ => {}
                }
            }
        }

        // Skip straight to the next possible spelling after this index key.
        let Some(next) = next_ascii_spelling(path, &last, &found) else {
            return Ok(false);
        };
        start = next;
    }
    // An inconclusive check is handled like an ambiguous spelling.
    Ok(true)
}

fn next_ascii_spelling(path: &str, last: &str, after: &str) -> Option<String> {
    let first = path.to_ascii_uppercase().into_bytes();
    let last = last.as_bytes();
    let mut spelling = first.clone();
    let mut last_increment = None;

    for (index, byte) in after.bytes().take(first.len()).enumerate() {
        let (low, high) = (first[index], last[index]);
        if byte < low {
            return Some(ascii_spelling(spelling));
        }
        if byte > high {
            break;
        }
        if byte > low && byte < high {
            spelling[index] = high;
            return Some(ascii_spelling(spelling));
        }
        spelling[index] = byte;
        if byte < high {
            last_increment = Some(index);
        }
        if index + 1 == after.len() && after.len() < first.len() {
            return Some(ascii_spelling(spelling));
        }
    }

    // Backtrack to the last position where a larger spelling is still
    // available, then take the smallest spelling of its remaining suffix.
    let index = last_increment?;
    spelling[index] = last[index];
    spelling[index + 1..].copy_from_slice(&first[index + 1..]);
    Some(ascii_spelling(spelling))
}

fn ascii_spelling(bytes: Vec<u8>) -> String {
    // Every non-ASCII byte comes from the input path.
    String::from_utf8(bytes).expect("ASCII casing preserves UTF-8")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn catalog_children_skip_descendants_and_keep_case_and_punctuation() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE indexed_entries (path TEXT PRIMARY KEY, kind INTEGER NOT NULL)",
            )
            .unwrap();
        for (path, kind) in [
            (r"C:\a", 1),
            (r"C:\a2", 0),
            (r"C:\a\descendant\leaf", 0),
            (r"C:\a]", 0),
            (r"C:\Case", 0),
            (r"C:\case", 0),
            (r"c:\orphan\descendant", 0),
        ] {
            connection
                .execute(
                    "INSERT INTO indexed_entries VALUES (?1, ?2)",
                    params![path, kind],
                )
                .unwrap();
        }
        let children = indexed_children(&connection, r"C:\").unwrap();
        assert_eq!(
            children,
            BTreeMap::from([
                ("Case".to_owned(), Some(IndexedEntryKind::File)),
                ("a".to_owned(), Some(IndexedEntryKind::Directory)),
                ("a2".to_owned(), Some(IndexedEntryKind::File)),
                ("a]".to_owned(), Some(IndexedEntryKind::File)),
                ("case".to_owned(), Some(IndexedEntryKind::File)),
                ("orphan".to_owned(), None),
            ]),
        );
        assert_eq!(remove_exact_path_tree(&connection, r"C:\Case").unwrap(), 1);
        assert!(indexed_children(&connection, r"C:\")
            .unwrap()
            .contains_key("case"));
    }

    #[test]
    fn ascii_case_successor_skips_to_the_next_possible_index_key() {
        let template = r"C:\aéB";
        let last = template.to_ascii_lowercase();
        let mut spellings = Vec::new();
        for drive in ['C', 'c'] {
            for first in ['A', 'a'] {
                for last in ['B', 'b'] {
                    spellings.push(format!("{drive}:\\{first}é{last}"));
                }
            }
        }

        for after in [
            r"B:\z",
            r"C:\",
            r"C:\AéB",
            r"C:\AéB\file",
            r"C:\Aè",
            r"C:\Aê",
            r"C:\ZéB",
            r"C:\aéb\file",
            r"D:\aéb",
            r"c:\aéb",
            r"d:\aéb",
        ] {
            let expected = spellings.iter().find(|spelling| spelling.as_str() > after);
            assert_eq!(
                next_ascii_spelling(template, &last, after).as_ref(),
                expected,
                "{after}",
            );
        }
    }
}
