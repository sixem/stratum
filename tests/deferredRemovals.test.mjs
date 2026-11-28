import assert from "node:assert/strict";
import test from "node:test";
import { reconcileRemovals, releaseVisibleRemovals } from "../src/lib/deferredRemovals.ts";

const entry = (name, fields = {}) => ({ type: "entry", key: name,
  entry: { path: name, name, isDir: false, size: null, modified: null, ...fields } });
const entries = names => names.map(name => entry(name));
const keys = layout => layout.rows.map(item => item.key);

test("new files sort around pending rows during removal and later refreshes", () => {
  const original = entries(["a", "b", "c", "d"]);
  const removed = reconcileRemovals(original, entries(["0", "a", "c", "d"]));
  assert.deepEqual(keys(removed), ["0", "a", "b", "c", "d"]);
  const refreshed = reconcileRemovals(removed.rows, entries(["0", "a", "ab", "bc", "d"]));
  assert.deepEqual(keys(refreshed), ["0", "a", "ab", "b", "bc", "c", "d"]);
  assert.deepEqual(refreshed.rows.filter(row => row.presence === "pending-removal").map(row => row.key), ["b", "c"]);
  assert.equal(refreshed.pending, 2);
});

test("refresh retains a missing slot once and uses new metadata when the name returns", () => {
  const original = entries(["a", "b", "c", "d"]);
  const live = [original[0], original[2], original[3]];
  const removed = reconcileRemovals(original, live);
  assert.equal(removed.rows[1].presence, "pending-removal");
  const refreshed = reconcileRemovals(removed.rows, live.map(item => ({ ...item })));
  assert.deepEqual(keys(refreshed), ["a", "b", "c", "d"]);
  assert.equal(refreshed.pending, 1);
  const returned = original.map(item => ({ ...item, entry: { ...item.entry, size: 23 } }));
  assert.deepEqual(reconcileRemovals(refreshed.rows, returned), { rows: returned, pending: 0 });
});

test("the parent and folder groups stay first when every original entry disappears", () => {
  const parent = { type: "parent", path: "/", key: "parent:/" };
  const previous = [parent, entry("z", { isDir: true }), entry("file02")];
  const live = [parent, entry("a", { isDir: true }), entry("file2"), entry("file10")];
  const layout = reconcileRemovals(previous, live);
  assert.deepEqual(keys(layout), ["parent:/", "a", "z", "file2", "file02", "file10"]);
  assert.equal(layout.pending, 2);
});

test("metadata sorting follows the pane's missing-value order when a surviving neighbor changes", () => {
  for (const key of ["size", "modified"]) {
    const scored = (name, value) => entry(name, { [key]: value });
    const old = [scored("a", 30), scored("b", 20), scored("c", 10)];
    const live = [scored("d", 25), scored("c", 10), scored("a", 5)];
    const missing = scored("unknown", null);
    const sort = { key, dir: "desc" };
    assert.deepEqual(keys(reconcileRemovals(old, [missing, ...live], sort)), ["unknown", "d", "b", "c", "a"]);
    assert.deepEqual(keys(reconcileRemovals(old, [...live, missing], sort, true)), ["d", "b", "c", "a", "unknown"]);
  }
});

test("pending local names follow native numeric, case and Unicode order in both directions", () => {
  const names = ["A2", "a2", "a02", "a10", "a00018446744073709551615", "a18446744073709551616",
    "a18446744073709551617", "aa2", "\uf900", "📁"];
  for (const dir of ["asc", "desc"]) {
    const ordered = dir === "asc" ? names : [...names].reverse();
    const previous = entries(ordered.filter((_, i) => i % 2 === 0));
    const live = entries(ordered.filter((_, i) => i % 2 === 1));
    assert.deepEqual(keys(reconcileRemovals(previous, live, { key: "name", dir })), ordered);
  }
});

test("SFTP keeps collator ties stable and resolved directory links in their listing group", () => {
  const old = [entry("a"), entry("file02"), entry("file2"), entry("link", { isDir: true, isSymlink: true })];
  const live = [entry("z", { isDir: true }), entry("a"), entry("file02"), entry("m")];
  const layout = reconcileRemovals(old, live, { key: "name", dir: "asc" }, true);
  assert.deepEqual(keys(layout), ["z", "a", "file02", "file2", "link", "m"]);
});

test("only the actual viewport releases slots, including partial grid rows and gaps", () => {
  const items = Array.from({ length: 20 }, (_, i) => entry(String(i)));
  const live = items.filter((_, i) => ![1, 6, 7, 13].includes(i));
  const layout = reconcileRemovals(items, live);
  // Two items per row, stride 30, card height 25, inset 10.
  assert.equal(releaseVisibleRemovals(layout, 95, 5, 30, 25, 2, 10), layout);
  const scrolled = releaseVisibleRemovals(layout, 99, 3, 30, 25, 2, 10);
  assert.equal(scrolled.pending, 2);
  assert.deepEqual(keys(scrolled).filter(key => ["1", "6", "7", "13"].includes(key)), ["1", "13"]);
  const top = releaseVisibleRemovals(scrolled, 0, 40, 30, 25, 2, 10);
  assert.equal(top.pending, 1);
  assert.ok(keys(top).includes("13"));
});

test("a large contiguous removal compacts newly visible empty slots in one pass", () => {
  const previous = Array.from({ length: 3000 }, (_, i) => entry(String(i)));
  const live = [previous[0], previous.at(-1)];
  const layout = reconcileRemovals(previous, live);
  assert.deepEqual(releaseVisibleRemovals(layout, 0, 60, 30, 30, 1, 0), { rows: live, pending: 0 });
});
