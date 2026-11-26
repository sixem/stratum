import test from "node:test";
import assert from "node:assert/strict";
import { scheduleUpdate, UPDATE_DAY_MS } from "../src/modules/updateSchedule.ts";

const published = "2026-10-18T10:00:00Z";
const start = Date.parse(published);
const hour = 3_600_000;

test("a release becomes eligible at its publication deadline, after a fresh check", () => {
  assert.deepEqual(scheduleUpdate(published, 24, start + hour), {
    eligible: false, nextCheck: start + UPDATE_DAY_MS,
  });
  assert.deepEqual(scheduleUpdate(published, 24, start + UPDATE_DAY_MS), {
    eligible: true, nextCheck: start + UPDATE_DAY_MS * 2,
  });
});

test("long delays recheck daily and a disabled delay offers a published release immediately", () => {
  assert.deepEqual(scheduleUpdate(published, 168, start), { eligible: false, nextCheck: start + UPDATE_DAY_MS });
  assert.equal(scheduleUpdate(published, 72, start + 71 * hour).nextCheck, start + 72 * hour);
  assert.equal(scheduleUpdate(published, 0, start).eligible, true);
  assert.equal(scheduleUpdate(published, 0, start - hour).eligible, false);
});

test("current or malformed feed data cannot create an offer", () => {
  for (const date of [undefined, "invalid"]) {
    assert.deepEqual(scheduleUpdate(date, 0, start), { eligible: false, nextCheck: start + UPDATE_DAY_MS });
  }
});
