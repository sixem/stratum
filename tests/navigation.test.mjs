import assert from "node:assert/strict";
import test from "node:test";
import { folderPathKey } from "../src/lib/paths.ts";
import { DirectoryCache } from "../src/hooks/domain/filesystem/directoryCache.ts";
import { buildQueryKey, DirectoryRequests } from "../src/hooks/domain/filesystem/directoryRequests.ts";
import { nextMetadataBatch } from "../src/hooks/domain/metadata/metadataBatch.ts";
import { jumpThroughTabHistory } from "../src/hooks/domain/session/tabHistoryStacks.ts";

const byName = { sort: { key: "name", dir: "asc" }, search: "" };
const open = (requests, path, cached = false, options) =>
  requests.start(path, buildQueryKey(path, byName), byName, cached, options);

test("a history jump preserves the folders it passes in the opposite stack", () => {
  const history = { back: ["A", "B", "C"], forward: ["F", "E"] };
  assert.equal(jumpThroughTabHistory(history, "back", "D", 1, 40, "B"), "B");
  assert.deepEqual(history, { back: ["A"], forward: ["F", "E", "D", "C"] });
  assert.equal(jumpThroughTabHistory(history, "forward", "B", 2, 40, "E"), "E");
  assert.deepEqual(history, { back: ["A", "B", "C", "D"], forward: ["F"] });
});

test("history rejects stale menu entries and bounds the opposite stack", () => {
  const history = { back: ["A", "B", "C"], forward: ["F", "E"] };
  assert.equal(jumpThroughTabHistory(history, "back", "D", 2, 3, "other"), null);
  assert.deepEqual(history, { back: ["A", "B", "C"], forward: ["F", "E"] });
  assert.equal(jumpThroughTabHistory(history, "back", "D", 2, 3, "A"), "A");
  assert.deepEqual(history, { back: [], forward: ["D", "C", "B"] });
});

test("navigating back supersedes a slow listing and its cleanup", () => {
  const requests = new DirectoryRequests();
  const a = open(requests, "Q:\\A");
  requests.commit(a);
  requests.finish(a);
  const b = open(requests, "Q:\\B");
  assert.equal(b.foreground, true);
  assert.equal(open(requests, a.path, false, { force: true, silent: true }), null);

  const back = open(requests, a.path, true);
  assert.equal(back.foreground, false);
  requests.commit(back);
  assert.equal(requests.commit(b), false);
  assert.equal(requests.finish(b), false);
  assert.equal(requests.displayed, back);
  requests.clear();
  assert.equal(requests.commit(back), false);
});

test("folder identities preserve the spelling of case-sensitive siblings", () => {
  const requests = new DirectoryRequests();
  const upper = open(requests, "Q:\\Folder");
  requests.commit(upper);
  requests.finish(upper);
  assert.equal(open(requests, "q:/Folder/"), null);
  const lower = open(requests, "Q:\\folder");
  assert.ok(lower);
  assert.equal(lower.foreground, true);
  assert.notEqual(lower.key, upper.key);
  assert.notEqual(folderPathKey("Q:"), folderPathKey("Q:\\"));
});

test("directory cache evicts older listings to stay within both budgets", () => {
  const cache = new DirectoryCache(3, 6);
  const listing = (count) => ({ entries: Array.from({ length: count }, () => ({})), totalCount: count, parentPath: null });
  const first = listing(2);
  cache.remember("a", first);
  cache.remember("b", listing(3));
  cache.remember("a", first);
  cache.remember("c", listing(3));
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), first);

  cache.remember("a", listing(7));
  assert.equal(cache.get("a"), undefined);
  assert.ok(cache.get("c"));

  for (const key of ["d", "e", "f"]) cache.remember(key, listing(0));
  assert.equal(cache.get("c"), undefined);
  assert.ok(cache.get("f"));
});

test("metadata prefetch examines each row once and only requests missing files", () => {
  const entries = Array.from({ length: 4000 }, (_, i) => ({
    path: String(i), isDir: i === 0, size: i % 2 ? 0 : null, modified: null,
  }));
  const known = new Map([["2", { path: "2", size: 5, modified: null }]]);
  const requested = [];
  let cursor = 0;
  while (cursor < entries.length) {
    const batch = nextMetadataBatch(entries, cursor, known, 120);
    assert.ok(batch.paths.length <= 120 && batch.cursor > cursor);
    cursor = batch.cursor;
    requested.push(...batch.paths);
  }
  assert.deepEqual(requested, entries.filter((_, i) => i >= 4 && i % 2 === 0).map(e => e.path));
  const complete = entries.map(e => ({ ...e, modified: 0 }));
  assert.deepEqual(nextMetadataBatch(complete, 0, known, 120), { paths: [], cursor: entries.length });
});
