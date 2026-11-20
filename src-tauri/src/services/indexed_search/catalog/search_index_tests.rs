// Regression coverage for migrating incomplete catalogs and preserving search semantics.
use std::{
    cell::Cell,
    collections::HashSet,
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::domain::indexed_search::IndexedPathQuery;

use super::*;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("current time")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "stratum-fts-test-{}-{timestamp}",
            std::process::id()
        ));
        fs::create_dir(&directory).expect("create test directory");
        Self(directory)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn create_legacy_tables(connection: &Connection) {
    connection
        .execute_batch(
            "CREATE TABLE indexed_entries (
                 entry_id INTEGER PRIMARY KEY,
                 path TEXT UNIQUE NOT NULL,
                 normalized_name TEXT NOT NULL,
                 kind INTEGER NOT NULL
             );
             CREATE TABLE indexed_entry_trigrams (
                 token TEXT NOT NULL,
                 entry_id INTEGER NOT NULL,
                 PRIMARY KEY(token, entry_id)
             ) WITHOUT ROWID;
             CREATE INDEX indexed_entry_trigrams_entry_id_idx
                 ON indexed_entry_trigrams(entry_id);
             CREATE TABLE indexed_catalog_meta (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );
             INSERT INTO indexed_catalog_meta VALUES ('searchTokensReady', '0');",
        )
        .expect("create legacy schema");
}

fn query_paths(store: &IndexedCatalogStore, query: &str) -> Vec<String> {
    query_paths_with_limit(store, query, None)
}

fn query_paths_with_limit(
    store: &IndexedCatalogStore,
    query: &str,
    limit: Option<usize>,
) -> Vec<String> {
    store
        .query(
            IndexedPathQuery {
                query: query.to_owned(),
                limit,
            },
            &[("C:\\".into(), "test-volume".into())],
        )
        .expect("query test catalog")
        .into_iter()
        .map(|entry| entry.path)
        .collect()
}

fn verify_test_volume(store: &IndexedCatalogStore) {
    store
        .connect()
        .unwrap()
        .execute(
            "INSERT INTO indexed_drive_catalog_state (drive_path, lifecycle_state, volume_id)
         VALUES (?1, 'ready', 'test-volume')",
            ["C:\\"],
        )
        .expect("record the test volume identity");
}

#[test]
fn interrupted_migration_resumes_and_keeps_changes_to_catalog_entries() {
    let directory = TestDirectory::new();
    let path = directory.0.join("catalog.db");
    let connection = Connection::open(&path).expect("open legacy catalog");
    create_legacy_tables(&connection);
    connection
        .execute_batch(
            r"INSERT INTO indexed_entries VALUES
                (-9223372036854775808, 'C:\a', 'a', 0),
                (10, 'C:\oldabc', 'oldabc', 0),
                (50, 'C:\removed', 'removed', 0),
                (100, 'C:\fallback', 'fallback', 0),
                (200, 'C:\moved', 'moved', 0),
                (9223372036854775807, 'C:\last', 'last', 0);
             INSERT INTO indexed_entry_trigrams VALUES ('old', 10);",
        )
        .expect("insert entries with incomplete legacy tokens");
    drop(connection);

    let store = IndexedCatalogStore::open(path.clone()).expect("open catalog for migration");
    verify_test_volume(&store);
    assert!(store
        .search_index_needs_backfill()
        .expect("pending migration"));

    let mut connection = store.connect().expect("open backfill connection");
    let checks = Cell::new(0);
    let stop_after_one_batch = || {
        let checked = checks.get();
        checks.set(checked + 1);
        checked > 0
    };
    assert!(
        !backfill(&mut connection, 2, usize::MAX, &stop_after_one_batch)
            .expect("cancel initial backfill")
    );
    assert!(matches!(
        required_state(&connection).expect("load durable cursor"),
        BackfillState::Pending(11)
    ));
    assert_eq!(query_paths(&store, "fallback"), ["C:\\fallback"]);

    connection
        .execute_batch(
            r"DELETE FROM indexed_entries WHERE entry_id IN (10, 50);
             INSERT INTO indexed_entries VALUES (10, 'C:\lower', 'lower', 0);
             UPDATE indexed_entries SET normalized_name = 'updated', entry_id = 11
                 WHERE entry_id = 200;",
        )
        .expect("change catalog entries during migration");
    drop(connection);
    drop(store);

    let store = IndexedCatalogStore::open(path).expect("reopen catalog");
    assert!(store
        .search_index_needs_backfill()
        .expect("resumable migration"));
    assert!(store
        .backfill_search_index(&|| false)
        .expect("resume migration"));
    assert!(!store
        .search_index_needs_backfill()
        .expect("migration completed"));

    let connection = store.connect().expect("validate migrated catalog");
    for sql in [
        "SELECT entry_id FROM indexed_entries EXCEPT SELECT rowid FROM indexed_entry_fts",
        "SELECT rowid FROM indexed_entry_fts EXCEPT SELECT entry_id FROM indexed_entries",
    ] {
        let is_empty = connection
            .query_row(sql, [], |_| Ok(()))
            .optional()
            .expect("compare row IDs");
        assert!(is_empty.is_none());
    }
    let retired_helper = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema
                 WHERE name = 'indexed_entry_trigrams'
                    OR name = 'indexed_entry_trigrams_entry_id_idx')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .expect("check legacy schema");
    assert!(!retired_helper);
    connection
        .execute(
            "INSERT INTO indexed_entry_fts(indexed_entry_fts) VALUES ('integrity-check')",
            [],
        )
        .expect("check FTS integrity");

    assert_eq!(query_paths(&store, "lower"), ["C:\\lower"]);
    assert_eq!(query_paths(&store, "updated"), ["C:\\moved"]);
    assert_eq!(query_paths(&store, "last"), ["C:\\last"]);
    assert!(query_paths(&store, "oldabc").is_empty());
    assert!(query_paths(&store, "removed").is_empty());
}

#[test]
fn fts_queries_match_fallback_with_punctuation_unicode_and_wildcards() {
    let directory = TestDirectory::new();
    let path = directory.0.join("catalog.db");
    let connection = Connection::open(&path).expect("open catalog");
    create_legacy_tables(&connection);
    for name in [
        "ABc",
        "ab_%",
        "\"AND\"OR",
        r"foo\bar",
        "éあ🍺",
        "e\u{301}あ🍺",
        "a",
        "xy",
        "a--b--z",
        "axb---z",
        "alpha phrase.txt",
        "report-alpha.tmp",
    ] {
        connection
            .execute(
                "INSERT INTO indexed_entries (path, normalized_name, kind) VALUES (?1, ?2, 0)",
                params![format!("C:\\{name}"), name],
            )
            .expect("insert legacy name");
    }
    drop(connection);

    let store = IndexedCatalogStore::open(path).expect("open catalog for migration");
    verify_test_volume(&store);
    let terms = [
        "abc",
        "AB_% ",
        "\"and\"or",
        r"foo\bar",
        "*Éあ🍺",
        "e\u{301}あ🍺",
        "?あ🍺",
        "a?b*z",
        "alpha ph*",
        "ab\0cdef",
        "xy",
        "*?",
    ];
    assert_eq!(query_paths(&store, "abc"), ["C:\\ABc"]);
    let fallback: Vec<_> = terms.iter().map(|term| query_paths(&store, term)).collect();

    assert!(store
        .backfill_search_index(&|| false)
        .expect("finish migration"));
    for (term, fallback_results) in terms.iter().zip(fallback) {
        assert_eq!(query_paths(&store, term), fallback_results, "term {term:?}");
    }
}

#[test]
fn upgrades_path_keyed_catalogs() {
    let directory = TestDirectory::new();
    let path = directory.0.join("catalog.db");
    let connection = Connection::open(&path).expect("open original catalog");
    connection
        .execute_batch(
            r"CREATE TABLE indexed_entries (
                 path TEXT PRIMARY KEY,
                 normalized_name TEXT NOT NULL,
                 kind INTEGER NOT NULL
             );
             INSERT INTO indexed_entries VALUES ('C:\path-keyed', 'path-keyed', 0);",
        )
        .expect("create path-keyed schema");
    drop(connection);

    let store = IndexedCatalogStore::open(path).expect("upgrade path-keyed catalog");
    verify_test_volume(&store);
    assert!(store
        .search_index_needs_backfill()
        .expect("pending migration"));
    assert!(store
        .backfill_search_index(&|| false)
        .expect("finish migration"));
    assert_eq!(query_paths(&store, "path-keyed"), ["C:\\path-keyed"]);
}

#[test]
fn exact_and_prefix_hits_survive_a_full_substring_candidate_set() {
    let directory = TestDirectory::new();
    let path = directory.0.join("catalog.db");
    let mut connection = Connection::open(&path).expect("open catalog");
    create_legacy_tables(&connection);
    let transaction = connection.transaction().unwrap();
    let names = (0..350)
        .map(|index| format!("a{index:03}-needle-\u{10ffff}.tmp"))
        .chain([
            "n".to_string(),
            "needle".to_string(),
            "needle.txt".to_string(),
            "\u{10ffff}".to_string(),
            "\u{10ffff}.txt".to_string(),
        ]);
    for name in names {
        transaction
            .execute(
                "INSERT INTO indexed_entries (path, normalized_name, kind) VALUES (?1, ?2, 0)",
                params![format!("C:\\{name}"), name],
            )
            .unwrap();
    }
    transaction.commit().unwrap();
    drop(connection);

    let store = IndexedCatalogStore::open(path).unwrap();
    verify_test_volume(&store);
    let assert_ranked = || {
        for (query, exact, prefix) in [
            ("needle", "needle", "needle.txt"),
            ("n", "n", "needle"),
            ("\u{10ffff}", "\u{10ffff}", "\u{10ffff}.txt"),
        ] {
            let results = query_paths_with_limit(&store, query, Some(100));
            assert_eq!(results.len(), 100);
            assert_eq!(
                &results[..2],
                &[format!("C:\\{exact}"), format!("C:\\{prefix}")]
            );
            assert_eq!(results.iter().collect::<HashSet<_>>().len(), 100);
        }
    };
    assert_ranked();
    assert!(store.backfill_search_index(&|| false).unwrap());
    assert_ranked();
}
