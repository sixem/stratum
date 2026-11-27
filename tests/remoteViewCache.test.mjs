import assert from "node:assert/strict";
import test from "node:test";
import { RemoteViewCache } from "../src/components/remote/remoteViewCache.ts";

test("remote view state is bounded and recently used folders remain cached", () => {
  const cache = new RemoteViewCache(2, 5);
  cache.set("host-session-a", ["a"], 2);
  cache.set("host-session-b", ["b"], 2);
  assert.deepEqual(cache.get("host-session-a"), ["a"]);
  cache.set("host-session-c", ["c"], 2);
  assert.equal(cache.get("host-session-b"), undefined);
  assert.deepEqual(cache.get("host-session-a"), ["a"]);
  assert.deepEqual(cache.get("host-session-c"), ["c"]);
  assert.equal(cache.get("other-session-a"), undefined);
  cache.set("host-session-a", ["oversized"], 6);
  assert.equal(cache.get("host-session-a"), undefined);
  cache.delete("host-session-c");
  assert.equal(cache.get("host-session-c"), undefined);
});
