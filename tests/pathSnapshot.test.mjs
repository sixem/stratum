import assert from "node:assert/strict";
import test from "node:test";
import { PathSnapshot } from "../src/lib/pathSnapshot.ts";

test("small updates and compaction preserve the metadata seen by earlier renders", () => {
  const original = { path: "a", size: 0, modified: null };
  const edited = { ...original, size: 1 };
  const listing = new PathSnapshot(new Map([["a", original]]));
  const pending = new Map([["a", edited]]);
  const updated = listing.withUpdates(pending);
  pending.clear();
  for (let i = 0; i < 1000; i++) {
    const path = String(i);
    pending.set(path, { path, size: null, modified: null });
  }
  const compacted = updated.withUpdates(pending);
  pending.clear();
  assert.equal(listing.get("a"), original);
  assert.equal(updated.get("a"), edited);
  assert.equal(compacted.get("a"), edited);
  assert.equal(updated.has("999"), false);
  assert.equal(compacted.has("999"), true);
  assert.equal(compacted.get("999").size, null);
});

test("thumbnail batches only copy the base cache when the overlay fills", () => {
  class TrackedMap extends Map {
    scans = 0;

    [Symbol.iterator]() {
      this.scans++;
      return super[Symbol.iterator]();
    }
  }
  const base = new TrackedMap([["a", "old.webp"], ["b", "b.webp"]]);
  const original = new PathSnapshot(base);
  assert.equal(original.withUpdates(new Map([["a", "old.webp"]])), original);

  const updated = original.withUpdates(new Map([["a", "new.webp"]]));
  assert.equal(base.scans, 0);
  assert.equal(updated.withUpdates(new Map([["a", "new.webp"], ["b", "b.webp"]])), updated);
  const pending = new Map(Array.from({ length: 512 }, (_, index) => [String(index), "extra.webp"]));
  const compacted = updated.withUpdates(pending);
  pending.clear();
  assert.equal(base.scans, 1);
  assert.equal(original.get("a"), "old.webp");
  assert.equal(updated.get("a"), "new.webp");
  assert.equal(updated.has("511"), false);
  assert.equal(compacted.get("a"), "new.webp");
  assert.equal(compacted.get("511"), "extra.webp");
  assert.equal(compacted.get("b"), "b.webp");
});
