import assert from "node:assert/strict";
import test from "node:test";
import {
  consumePendingChanges,
  createWatchRefreshSchedulerState,
  evaluateActiveRefresh,
  finishRefreshRun,
} from "../src/hooks/domain/filesystem/watchRefreshScheduler.ts";

test("a watcher refresh during the cooldown waits for the deadline", () => {
  const state = createWatchRefreshSchedulerState();
  const context = {
    enabled: true, activeTabId: "main", activeTabPath: "E:\\Work", currentPath: "E:\\Work",
    loading: false, now: 10_000, refreshCooldownMs: 900,
  };
  assert.equal(evaluateActiveRefresh(state, context).kind, "start");
  assert.equal(finishRefreshRun(state), false);
  assert.deepEqual(evaluateActiveRefresh(state, { ...context, now: 10_200 }), { kind: "defer", delayMs: 700 });
  assert.equal(state.dirtyTabIds.has("main"), true);
  assert.equal(state.refreshQueued, false);
  assert.equal(evaluateActiveRefresh(state, { ...context, now: 10_900 }).kind, "start");
  assert.equal(state.dirtyTabIds.has("main"), false);
});

test("lost notifications dirty only tabs for the reported folder", () => {
  const state = createWatchRefreshSchedulerState();
  const result = consumePendingChanges(state, {
    pendingPaths: ["e:\\Case"], renamePaths: [], activeTabId: "lowercase", activeTabPath: "E:\\case",
    tabs: [{ id: "lowercase", path: "E:\\case" }, { id: "uppercase", path: "E:\\Case" }],
  });
  assert.equal(result.shouldRefreshActive, false);
  assert.deepEqual([...state.dirtyTabIds], ["uppercase"]);
});
