import assert from "node:assert/strict";
import test from "node:test";
import { EntryMetaSnapshot } from "../src/hooks/domain/filesystem/entryMetaSnapshot.ts";

test("small updates and compaction preserve the metadata seen by earlier renders", () => {
  const original = { path: "a", size: 0, modified: null };
  const edited = { ...original, size: 1 };
  const listing = new EntryMetaSnapshot(new Map([["a", original]]));
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
