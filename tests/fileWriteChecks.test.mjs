import assert from "node:assert/strict";
import test from "node:test";
import { FileWriteChecks } from "../src/hooks/domain/filesystem/fileWriteChecks.ts";

test("a new write only restarts follow-up checks for its own path", () => {
  const checks = new FileWriteChecks();
  checks.schedule(["a", "b"], 0);
  checks.schedule(["b"], 500);
  assert.equal(checks.nextDueAt, 1000);
  assert.deepEqual(checks.takeDue(1000), ["a"]);
  assert.equal(checks.nextDueAt, 1500);
  assert.deepEqual(checks.takeDue(1500), ["b"]);
  assert.deepEqual(checks.takeDue(3000), ["a"]);
  assert.deepEqual(checks.takeDue(3500), ["b"]);
  assert.deepEqual(checks.takeDue(7000), ["a"]);
  assert.deepEqual(checks.takeDue(7500), ["b"]);
  assert.equal(checks.nextDueAt, null);
});

test("a stream of writes uses only three follow-up stats per distinct path", () => {
  const checks = new FileWriteChecks();
  const callsByPath = new Map();
  for (let now = 0; now <= 157_000; now += 500) {
    if (now < 150_000 && now % 1500 === 0) checks.schedule([String(now)], now);
    for (const path of checks.takeDue(now)) callsByPath.set(path, (callsByPath.get(path) ?? 0) + 1);
  }
  assert.equal(callsByPath.size, 100);
  assert.ok([...callsByPath.values()].every((count) => count === 3));
  assert.equal(checks.nextDueAt, null);
});
