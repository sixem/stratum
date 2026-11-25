import assert from "node:assert/strict";
import test from "node:test";
import { reorderTabs, setTabAnchored } from "../src/lib/tabAnchors.ts";

const fixture = () => ["a", "b", "c", "d"].map(id => ({ id }));
const order = tabs => tabs.map(({ id }) => id).join("");

test("anchors join the leading group in anchor order", () => {
  const first = setTabAnchored(fixture(), "c", true);
  const both = setTabAnchored(first, "a", true);
  assert.equal(order(both), "cabd");
  assert.deepEqual(both.map(({ anchored }) => Boolean(anchored)), [true, true, false, false]);
  assert.equal(setTabAnchored(both, "a", true), both);

  const unanchored = setTabAnchored(both, "c", false);
  assert.equal(order(unanchored), "acbd");
  assert.deepEqual(unanchored.map(({ anchored }) => Boolean(anchored)), [true, false, false, false]);
});

test("reordering stays within the source tab's group", () => {
  const tabs = setTabAnchored(setTabAnchored(fixture(), "a", true), "b", true);
  assert.equal(order(reorderTabs(tabs, "a", 4)), "bacd");
  assert.equal(order(reorderTabs(tabs, "d", 0)), "abdc");
  assert.equal(reorderTabs(tabs, "b", 4), tabs);
  assert.equal(reorderTabs(tabs, "c", 0), tabs);
});
