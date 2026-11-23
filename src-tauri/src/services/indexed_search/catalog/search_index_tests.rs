// Regression coverage for migrating incomplete catalogs and preserving search semantics.
use std::{
    cell::Cell,
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::domain::indexed_search::{
    IndexedEntryKind, IndexedFolderPageQuery, IndexedFolderScope, IndexedPathPage,
    IndexedPathPageQuery, IndexedPathQuery,
};

use super::super::{pagination::read_page, recursive_build::RecursiveBuild, CatalogEntryRecord};
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
             INSERT INTO indexed_entries (entry_id, path, normalized_name, kind)
                 VALUES (10, 'C:\lower', 'lower', 0);
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

#[test]
fn keyset_pages_cover_prefixes_substrings_and_equal_names() {
    let directory = TestDirectory::new();
    let path = directory.0.join("catalog.db");
    let mut connection = Connection::open(&path).unwrap();
    create_legacy_tables(&connection);

    // Equal names resume by their index row IDs, even across page boundaries.
    let prefixes = (0..77)
        .rev()
        .map(|number| (format!(r"C:\folder{number:03}\needle.txt"), "needle.txt"));
    let substrings = (0..81).map(|number| {
        (
            format!(r"C:\folder{number:03}\a-needle.txt"),
            "a-needle.txt",
        )
    });
    let visible: Vec<_> = [(r"C:\needle".to_owned(), "needle")]
        .into_iter()
        .chain(prefixes)
        .chain(substrings)
        .collect();
    let transaction = connection.transaction().unwrap();
    transaction
        .execute(
            "INSERT INTO indexed_entries (path, normalized_name, kind) VALUES (?1, 'needle', 0)",
            [r"Z:\needle"],
        )
        .unwrap();
    for (path, name) in &visible {
        transaction
            .execute(
                "INSERT INTO indexed_entries (path, normalized_name, kind) VALUES (?1, ?2, 0)",
                params![path, name],
            )
            .unwrap();
    }
    transaction.commit().unwrap();
    drop(connection);
    let store = IndexedCatalogStore::open(path).unwrap();
    verify_test_volume(&store);
    assert!(store.search_index_needs_backfill().unwrap());

    let volumes = [("C:\\".to_owned(), "test-volume".to_owned())];
    let page = |query: &str, cursor: Option<String>| {
        store.query_page(
            IndexedPathPageQuery {
                search: IndexedPathQuery {
                    query: query.into(),
                    limit: Some(25),
                },
                cursor,
            },
            &volumes,
        )
    };
    let results = |query| {
        let mut cursor = None;
        let mut paths = Vec::new();
        loop {
            let response = page(query, cursor).unwrap();
            paths.extend(response.matches.into_iter().map(|entry| entry.path));
            assert!(paths.len() <= visible.len());
            let Some(next) = response.next_cursor else {
                return paths;
            };
            cursor = Some(next);
        }
    };
    let expected: Vec<_> = visible.iter().map(|(path, _)| path.clone()).collect();
    assert_eq!(results("needle"), expected);
    let wildcard = results("*needle*");
    assert_eq!(wildcard.len(), expected.len());
    assert_eq!(wildcard[0], r"C:\folder000\a-needle.txt");

    assert!(store.backfill_search_index(&|| false).unwrap());
    assert_eq!(results("needle"), expected);
    assert_eq!(results("*needle*"), wildcard);

    let cursor = page("needle", None).unwrap().next_cursor;
    assert!(page("other", cursor).is_err());
    assert!(page("needle", Some("invalid".to_owned())).is_err());
}

fn indexed_file(folder: &str, name: &str) -> CatalogEntryRecord {
    CatalogEntryRecord::new(
        format!(r"{folder}\{name}"),
        name.to_lowercase(),
        IndexedEntryKind::File,
    )
}

#[test]
fn folder_pages_filter_drive_kind_and_depth_before_pagination() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    store.connect().unwrap().execute_batch(
        r"INSERT INTO indexed_drive_catalog_state (drive_path, lifecycle_state, volume_id) VALUES
            ('C:\', 'ready', 'first-volume'),
            ('D:\', 'ready', 'second-volume'),
            ('E:\', 'ready', 'previous-volume');",
    ).unwrap();
    let folder = |path: &str, name: &str| {
        CatalogEntryRecord::new(
            path.into(),
            name.to_lowercase(),
            IndexedEntryKind::Directory,
        )
    };
    let mut entries = vec![
        folder(r"C:\needle", "needle"),
        folder(r"C:\z-NEEDLE", "z-NEEDLE"),
        folder(r"D:\z-needle", "z-needle"),
        folder(r"E:\0-needle", "0-needle"),
    ];
    for index in 0..300 {
        let name = format!("0-needle-{index:03}");
        entries.push(indexed_file("C:", &name));
        entries.push(folder(&format!(r"C:\archive\{name}"), &name));
    }
    let mut writer = store.begin_write().unwrap();
    writer.insert_batch(&entries).unwrap();
    writer.finish().unwrap();
    assert!(!store.search_index_needs_backfill().unwrap());

    let volumes = [
        ("C:\\".into(), "first-volume".into()),
        ("D:\\".into(), "second-volume".into()),
        ("E:\\".into(), "current-volume".into()),
    ];
    let page = |search: &str, roots: Option<&[&str]>, max_depth, cursor| {
        store.query_folder_page(
            IndexedFolderPageQuery {
                search: search.into(),
                limit: Some(1),
                cursor,
                scope: IndexedFolderScope {
                    scope_roots: roots
                        .map(|roots| roots.iter().map(|root| (*root).into()).collect()),
                    max_depth,
                },
            },
            &volumes,
        )
    };
    let first = page("needle", Some(&["e:/", "d:/", "c:\\"]), Some(1), None).unwrap();
    assert_eq!(first.matches[0].path, r"C:\needle");
    let cursor = first.next_cursor.unwrap();
    assert!(page("needle", Some(&["C:"]), Some(1), Some(cursor.clone())).is_err());
    assert!(page(
        "needle",
        Some(&["C:", "D:", "E:"]),
        Some(2),
        Some(cursor.clone())
    )
    .is_err());
    assert!(store
        .query_page(page_query("needle", Some(cursor.clone()), 1), &volumes)
        .is_err());

    let second = page(
        "needle",
        Some(&["C:", "C:\\", "D:", "E:"]),
        Some(1),
        Some(cursor),
    )
    .unwrap();
    assert_eq!(second.matches[0].path, r"C:\z-NEEDLE");
    let last = page(
        "needle",
        Some(&["C:", "D:", "E:"]),
        Some(1),
        second.next_cursor,
    )
    .unwrap();
    assert_eq!(last.matches[0].path, r"D:\z-needle");
    assert!(last.next_cursor.is_none());

    let deep = page("*needle*", Some(&["C:"]), Some(2), None).unwrap();
    assert_eq!(deep.matches[0].path, r"C:\archive\0-needle-000");
    let unbounded = page("*needle*", None, None, None).unwrap();
    assert_eq!(unbounded.matches[0].path, deep.matches[0].path);
    for (search, roots, depth) in [
        ("needle", Some(&[][..]), None),
        ("needle", None, Some(0)),
        ("  ", None, None),
    ] {
        let empty = page(search, roots, depth, None).unwrap();
        assert!(empty.matches.is_empty());
        assert!(empty.next_cursor.is_none());
    }
    assert!(page("needle", Some(&[r"C:\archive"]), None, None).is_err());
}

#[test]
fn folder_path_pages_match_whole_parents_and_a_partial_leaf() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    store.connect().unwrap().execute_batch(
        r"INSERT INTO indexed_drive_catalog_state (drive_path, lifecycle_state, volume_id) VALUES
            ('C:\', 'ready', 'first-volume'),
            ('D:\', 'ready', 'second-volume');",
    ).unwrap();
    let mut entries: Vec<_> = [
        r"C:\Álpha\Work\Résumé",
        r"d:\ÁLPHA\Work\Résumé copy",
        r"C:\Outer\Álpha\Work\Résumé extra",
        r"C:\NotÁlpha\Work\Résumé outside",
        r"C:\Álpha\Workshop\Résumé outside",
        r"C:\Álpha\Work\some-résumé",
        r"C:\Álpha\Work\Nested\Résumé deeper",
        r"C:\Álpha\Work",
        r"C:\Álpha",
    ]
    .iter()
    .map(|&path| {
        let (_, name) = path.rsplit_once('\\').unwrap();
        CatalogEntryRecord::new(
            path.into(),
            name.to_lowercase(),
            IndexedEntryKind::Directory,
        )
    })
    .collect();
    entries.push(indexed_file(r"C:\Álpha\Work", "résa.txt"));
    let mut writer = store.begin_write().unwrap();
    writer.insert_batch(&entries).unwrap();
    writer.finish().unwrap();
    let volumes = [
        ("C:\\".into(), "first-volume".into()),
        ("D:\\".into(), "second-volume".into()),
    ];
    let page = |search: &str, roots: Option<Vec<String>>, max_depth, limit, cursor| {
        store.query_folder_page(
            IndexedFolderPageQuery {
                search: search.into(),
                limit: Some(limit),
                cursor,
                scope: IndexedFolderScope {
                    scope_roots: roots,
                    max_depth,
                },
            },
            &volumes,
        )
    };
    let first = page("álpha/work/rés", None, None, 1, None).unwrap();
    assert_eq!(first.matches[0].path, r"C:\Álpha\Work\Résumé");
    let cursor = first.next_cursor.unwrap();
    assert!(page("rés", None, None, 1, Some(cursor.clone())).is_err());
    let second = page(r"ÁLPHA\WORK\RÉS", None, None, 10, Some(cursor)).unwrap();
    assert_eq!(
        second
            .matches
            .iter()
            .map(|item| item.path.as_str())
            .collect::<Vec<_>>(),
        [
            r"d:\ÁLPHA\Work\Résumé copy",
            r"C:\Outer\Álpha\Work\Résumé extra",
        ]
    );
    assert!(second.next_cursor.is_none());

    let explicit = page(r"\\?\D:\álpha\work\rés", None, Some(3), 10, None).unwrap();
    assert_eq!(explicit.matches[0].path, r"d:\ÁLPHA\Work\Résumé copy");
    assert_eq!(explicit.matches.len(), 1);
    assert!(
        page("D:/álpha/work/rés", Some(vec!["C:".into()]), None, 10, None)
            .unwrap()
            .matches
            .is_empty()
    );
    assert!(page("D:/álpha/work/rés", None, Some(2), 10, None)
        .unwrap()
        .matches
        .is_empty());
    assert!(page(r"\\álpha\work\rés", None, None, 10, None)
        .unwrap()
        .matches
        .is_empty());
    assert_eq!(
        page("c:", None, None, 10, None).unwrap().matches[0].path,
        r"C:\Álpha"
    );
    let children = page("C:/álpha/work/", None, None, 10, None).unwrap();
    assert_eq!(
        children
            .matches
            .iter()
            .map(|item| item.path.as_str())
            .collect::<Vec<_>>(),
        [r"C:\Álpha\Work\Résumé", r"C:\Álpha\Work\some-résumé",]
    );
}

fn page_query(term: &str, cursor: Option<String>, limit: usize) -> IndexedPathPageQuery {
    IndexedPathPageQuery {
        search: IndexedPathQuery {
            query: term.into(),
            limit: Some(limit),
        },
        cursor,
    }
}

fn assert_page_parity(term: &str, probe: &IndexedPathPage, fts: &IndexedPathPage) {
    assert_eq!(
        serde_json::to_value(probe).unwrap(),
        serde_json::to_value(fts).unwrap(),
        "different result or continuation for {term:?}",
    );
}

#[test]
fn typed_search_filters_the_disk_catalog_before_paging_and_ranking() {
    const GIB: i64 = 1_073_741_824;
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    verify_test_volume(&store);
    let volumes = [(r"C:\".into(), "test-volume".into())];
    let sized_files = [
        ("concert-prefix.MP4", GIB + 1),
        ("b-concert.mkv", GIB + 2),
        ("c-concert.webm", GIB + 3),
        ("concert-at-boundary.mp4", GIB),
        ("concert-below-boundary.mp4", GIB - 1),
        ("!show-1.mp4", GIB + 1),
        ("!show-2.mkv", GIB + 2),
        ("!show-3.webm", GIB + 3),
        ("concert-discussion.txt", GIB + 1),
    ];
    let mut entries: Vec<_> = sized_files
        .iter()
        .map(|(name, _)| indexed_file("C:", name))
        .collect();
    for number in 0..300 {
        entries.push(indexed_file("C:", &format!("a{number:03}-concert.mp4")));
        entries.push(indexed_file("C:", &format!("concert-{number:03}.mp4")));
    }
    entries.push(CatalogEntryRecord::new(
        r"C:\concert-folder.mp4".into(),
        "concert-folder.mp4".into(),
        IndexedEntryKind::Directory,
    ));
    let mut writer = store.begin_write().unwrap();
    writer.insert_batch(&entries).unwrap();
    writer.finish().unwrap();
    assert!(!store.search_index_needs_backfill().unwrap());

    let mut connection = store.connect().unwrap();
    let sizes = connection.transaction().unwrap();
    for (name, size) in sized_files {
        sizes
            .execute(
                "UPDATE indexed_entries SET size_bytes = ?1 WHERE normalized_name = ?2",
                params![size, name.to_lowercase()],
            )
            .unwrap();
    }
    sizes.commit().unwrap();

    let expression = ">1GB type:video concert";
    let expected = [
        r"C:\concert-prefix.MP4",
        r"C:\b-concert.mkv",
        r"C:\c-concert.webm",
    ];
    let snapshot = connection.transaction().unwrap();
    let mut cursor = None;
    for (path, size) in expected.into_iter().zip(GIB + 1..=GIB + 3) {
        let request = || page_query(expression, cursor.clone(), 1);
        let page = read_page(&snapshot, request(), &volumes, true).unwrap();
        let fts = read_page(&snapshot, request(), &volumes, false).unwrap();
        assert_page_parity(expression, &page, &fts);
        assert_eq!(page.matches.len(), 1);
        assert_eq!(page.matches[0].path, path);
        assert_eq!(page.matches[0].size_bytes, Some(size as u64));
        cursor = page.next_cursor;
    }
    assert!(cursor.is_none());
    let ordered_expression = ">1GB type:video show";
    let ordered = read_page(
        &snapshot,
        page_query(ordered_expression, None, 2),
        &volumes,
        true,
    )
    .unwrap();
    let fts = read_page(
        &snapshot,
        page_query(ordered_expression, None, 2),
        &volumes,
        false,
    )
    .unwrap();
    assert_page_parity(ordered_expression, &ordered, &fts);
    assert_eq!(ordered.matches.len(), 2);
    assert!(ordered.next_cursor.is_some());
    drop(snapshot);

    let page = store
        .query_page(page_query(expression, None, 1), &volumes)
        .unwrap();
    let cursor = page.next_cursor.unwrap();
    for changed in [
        "concert",
        ">=1GB type:video concert",
        ">1GB type:audio concert",
    ] {
        assert!(store
            .query_page(page_query(changed, Some(cursor.clone()), 1), &volumes)
            .is_err());
    }
    let legacy = store
        .query(page_query(expression, None, 3).search, &volumes)
        .unwrap();
    assert_eq!(
        legacy
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        expected
    );

    let paths = |search| {
        store
            .query_page(page_query(search, None, 10), &volumes)
            .unwrap()
            .matches
            .into_iter()
            .map(|entry| entry.path)
            .collect::<Vec<_>>()
    };
    assert_eq!(paths("=1GB"), [r"C:\concert-at-boundary.mp4"]);
    assert_eq!(paths("<1GB type:video"), [r"C:\concert-below-boundary.mp4"]);
    assert_eq!(paths("type:folder"), [r"C:\concert-folder.mp4"]);
    let folder_page = store
        .query_folder_page(
            IndexedFolderPageQuery {
                search: "type:folder".into(),
                limit: None,
                cursor: None,
                scope: IndexedFolderScope {
                    scope_roots: None,
                    max_depth: None,
                },
            },
            &volumes,
        )
        .unwrap();
    assert!(folder_page.matches.is_empty());
    assert!(paths("type:video")
        .iter()
        .any(|path| path == r"C:\a000-concert.mp4"));
    assert!(paths(">1GB <1GB").is_empty());

    // A pending row remains available to name search and qualifies as soon as
    // an independent write publishes its known size.
    assert_eq!(paths("a000-concert"), [r"C:\a000-concert.mp4"]);
    assert!(paths(">1GB a000-concert").is_empty());
    connection
        .execute(
            "UPDATE indexed_entries SET size_bytes = ?1 WHERE normalized_name = 'a000-concert.mp4'",
            [GIB + 1],
        )
        .unwrap();
    assert_eq!(paths(">1GB a000-concert"), [r"C:\a000-concert.mp4"]);
}

#[test]
fn substring_pages_match_fts_while_a_disk_catalog_refreshes() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    verify_test_volume(&store);
    let mut baseline = store.begin_write().unwrap();
    let mut entries = vec![
        indexed_file("C:", "log"),
        indexed_file("C:", "log-copy.txt"),
    ];
    // Reverse folder order so ties must resume by row ID instead of path.
    for number in (0..700).rev() {
        entries.push(indexed_file(&format!(r"C:\{number:03}"), "a-log.txt"));
        if number < 30 {
            for name in ["b%_log.txt", "Éあ🍺-log.txt", "e\u{301}あ🍺-log.txt"] {
                entries.push(indexed_file(&format!(r"C:\{number:03}"), name));
            }
        }
    }
    entries.extend([
        indexed_file("C:", "0-rare-entry.txt"),
        indexed_file("C:", "z-rare-entry.txt"),
        indexed_file("C:", "xy"),
    ]);
    baseline.insert_batch(&entries).unwrap();
    baseline.finish().unwrap();

    let mut original = store.begin_drive_refresh("D:\\").unwrap();
    original
        .insert_batch(&[indexed_file("D:", "log-original.txt")])
        .unwrap();
    original
        .finish_drive_refresh("D:\\", "test", 0, "second-volume", None, || Ok(()))
        .unwrap();
    let mut replaced = store.begin_drive_refresh("Z:\\").unwrap();
    replaced
        .insert_batch(&[indexed_file("Z:", "0-log-replaced.txt")])
        .unwrap();
    replaced
        .finish_drive_refresh("Z:\\", "test", 0, "previous-volume", None, || Ok(()))
        .unwrap();
    let mut building = RecursiveBuild::open(&store, "E:\\", "building-volume", 0, None)
        .unwrap()
        .unwrap();
    building
        .write_chunk(
            "",
            &[indexed_file("E:", "0-log-building.txt")],
            &[],
            0,
            true,
        )
        .unwrap();

    let mut refresh = store.begin_drive_refresh("D:\\").unwrap();
    refresh
        .insert_batch(&[indexed_file("D:", "log-pending.txt")])
        .unwrap();
    let verified = [
        ("C:\\".into(), "test-volume".into()),
        ("D:\\".into(), "second-volume".into()),
        ("E:\\".into(), "building-volume".into()),
        ("Z:\\".into(), "current-volume".into()),
    ];
    let mut reader = store.connect().unwrap();
    let mode: String = reader
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(mode, "wal");
    let snapshot = reader.transaction().unwrap();
    for term in [
        "log",
        "*LOG*",
        "*%_log*",
        "éあ🍺",
        "e\u{301}あ🍺",
        "rare-entry",
        "log txt",
        "xy",
    ] {
        let mut cursor = None;
        let mut seen = HashSet::new();
        loop {
            let probe = read_page(
                &snapshot,
                page_query(term, cursor.clone(), 37),
                &verified,
                true,
            )
            .unwrap();
            let fts = read_page(
                &snapshot,
                page_query(term, cursor.clone(), 37),
                &verified,
                false,
            )
            .unwrap();
            assert_page_parity(term, &probe, &fts);
            for entry in probe.matches {
                assert!(seen.insert(entry.path));
            }
            let Some(next) = probe.next_cursor else { break };
            assert_ne!(cursor.as_ref(), Some(&next));
            cursor = Some(next);
        }
        assert!(!seen.contains(r"E:\0-log-building.txt"));
        assert!(!seen.contains(r"Z:\0-log-replaced.txt"));
        assert!(!seen.contains(r"D:\log-pending.txt"));
        if term == "log" {
            assert_eq!(seen.len(), entries.len() - 2);
            assert!(seen.contains(r"D:\log-original.txt"));
        }
    }

    // Readers retain the same published snapshot even when a write commits.
    refresh
        .finish_drive_refresh("D:\\", "test", 0, "second-volume", None, || Ok(()))
        .unwrap();
    let old = read_page(&snapshot, page_query("log", None, 37), &verified, true).unwrap();
    let fts = read_page(&snapshot, page_query("log", None, 37), &verified, false).unwrap();
    assert_page_parity("log", &old, &fts);
    assert!(old
        .matches
        .iter()
        .any(|entry| entry.path == r"D:\log-original.txt"));
    let published = store
        .query_page(page_query("log", None, 37), &verified)
        .unwrap();
    assert!(published
        .matches
        .iter()
        .any(|entry| entry.path == r"D:\log-pending.txt"));
    assert!(!published
        .matches
        .iter()
        .any(|entry| entry.path == r"D:\log-original.txt"));
}

#[test]
#[ignore = "writes a large disposable SQLite catalog for a concurrent indexing benchmark"]
fn measure_substring_pages_during_disk_indexing() {
    let directory = TestDirectory::new();
    let store = IndexedCatalogStore::open(directory.0.join("catalog.db")).unwrap();
    verify_test_volume(&store);
    let mut baseline = store.begin_write().unwrap();
    for start in (0..450_000).step_by(1024) {
        let entries: Vec<_> = (start..(start + 1024).min(450_000))
            .map(|index| {
                let suffix = if index % 4 == 0 { "report" } else { "log" };
                indexed_file(r"C:\archive", &format!("a{index:07}-{suffix}.txt"))
            })
            .collect();
        baseline.insert_batch(&entries).unwrap();
    }
    baseline
        .insert_batch(&[indexed_file("C:", "z-rare-entry.txt")])
        .unwrap();
    baseline.finish().unwrap();

    let committed_batches = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    let verified = [("C:\\".into(), "test-volume".into())];
    let mut reader = store.connect().unwrap();
    thread::scope(|threads| {
        let (started, ready) = mpsc::sync_channel(1);
        let store_for_writer = &store;
        let stop_writer = &stop;
        let batches_written = &committed_batches;
        threads.spawn(move || {
            let mut build =
                RecursiveBuild::open(store_for_writer, "D:\\", "building-volume", 0, None)
                    .unwrap()
                    .unwrap();
            for batch in 0..512 {
                if stop_writer.load(Ordering::Relaxed) {
                    break;
                }
                let entries: Vec<_> = (0..256)
                    .map(|index| indexed_file("D:", &format!("b{batch:03}-{index:03}-log.txt")))
                    .collect();
                build.write_chunk("", &entries, &[], 0, false).unwrap();
                batches_written.fetch_add(1, Ordering::Release);
                if batch == 0 {
                    started.send(()).unwrap();
                }
                thread::sleep(Duration::from_millis(2));
            }
        });
        ready.recv_timeout(Duration::from_secs(30)).unwrap();
        let before = committed_batches.load(Ordering::Acquire);
        for (term, pages) in [("log", 3), ("rare-entry", 1)] {
            let mut times = [Vec::new(), Vec::new()];
            for run in 0..7 {
                let snapshot = reader.transaction().unwrap();
                let mut cursor = None;
                for _ in 0..pages {
                    let mut read = |probe: bool| {
                        let start = Instant::now();
                        let result = read_page(
                            &snapshot,
                            page_query(term, cursor.clone(), 64),
                            &verified,
                            probe,
                        )
                        .unwrap();
                        if run > 0 {
                            times[usize::from(probe)].push(start.elapsed());
                        }
                        result
                    };
                    let (fts, probe) = if run % 2 == 0 {
                        (read(false), read(true))
                    } else {
                        let probe = read(true);
                        (read(false), probe)
                    };
                    assert_page_parity(term, &probe, &fts);
                    cursor = probe.next_cursor;
                }
            }
            for samples in &mut times {
                samples.sort_unstable();
            }
            let [fts, probe] = times;
            println!(
                "{term}: FTS {:?}, bounded probe {:?} median while indexing",
                fts[fts.len() / 2],
                probe[probe.len() / 2]
            );
        }
        stop.store(true, Ordering::Relaxed);
        let concurrent_batches = committed_batches.load(Ordering::Acquire) - before;
        assert!(
            concurrent_batches > 0,
            "writer must commit while queries run"
        );
        println!("{concurrent_batches} baseline batches committed during comparisons");
    });
}
