import assert from "node:assert/strict";
import test from "node:test";
import { advanceWorkPillProgress, WORK_PILL_FADE_MS } from "../src/components/transfer/workPillProgress.ts";

const copy = (id, startedAt, bytesCompleted, overrides = {}) => ({
  id,
  kind: "copy",
  status: "running",
  phase: "executing",
  startedAt,
  total: 4,
  processed: 0,
  bytesTotal: 1000,
  bytesCompleted,
  ...overrides,
});

test("the work fill tracks whole-job bytes and stays with the same job", () => {
  const first = copy("first", 1, 250, { currentBytes: 90, currentTotalBytes: 100 });
  const second = copy("second", 2, 700);
  const shown = advanceWorkPillProgress(null, [second, first], 3);
  assert.equal(shown.jobId, "first");
  assert.equal(shown.fraction, 0.25);

  const adjusted = { ...first, bytesTotal: 2000, bytesCompleted: 400 };
  assert.equal(advanceWorkPillProgress(shown, [second, adjusted], 4), shown);
  const later = advanceWorkPillProgress(shown, [second, { ...adjusted, bytesCompleted: 1000 }], 5);
  assert.equal(later.jobId, "first");
  assert.equal(later.fraction, 0.5);
});

test("completed work holds a full fill before fading and handing off", () => {
  const first = copy("first", 1, 600);
  const second = copy("second", 2, 240);
  const shown = advanceWorkPillProgress(null, [first, second], 3);
  const jobs = [{ ...first, status: "completed" }, second];
  const done = advanceWorkPillProgress(shown, jobs, 4);
  assert.equal(done.fraction, 1);
  assert.equal(done.jobId, "first");
  assert.equal(done.transition.phase, "hold");
  assert.equal(advanceWorkPillProgress(done, jobs, done.transition.until - 1), done);

  const fading = advanceWorkPillProgress(done, jobs, done.transition.until);
  assert.equal(fading.transition.phase, "fade");
  assert.equal(fading.transition.until - done.transition.until, WORK_PILL_FADE_MS);
  const next = advanceWorkPillProgress(fading, jobs, fading.transition.until);
  assert.deepEqual(next, { jobId: "second", fraction: 0.24, transition: null });
  assert.equal(advanceWorkPillProgress(null, [jobs[0]], 10000), null);
});

test("paused work yields to running work, and cancellations fade at their current fraction", () => {
  const first = copy("first", 1, 500);
  const shown = advanceWorkPillProgress(null, [first], 2);
  const paused = { ...first, status: "paused" };
  assert.equal(advanceWorkPillProgress(shown, [paused], 3), shown);

  const second = copy("second", 4, 100);
  const fading = advanceWorkPillProgress(shown, [paused, second], 5);
  assert.equal(fading.fraction, 0.5);
  assert.equal(fading.transition.phase, "fade");
  assert.equal(advanceWorkPillProgress(fading, [paused, second], fading.transition.until).jobId, "second");
  const cancelled = advanceWorkPillProgress(shown, [{ ...first, status: "cancelled" }], 5);
  assert.equal(cancelled.fraction, 0.5);
  assert.equal(cancelled.transition.phase, "fade");
});

test("item jobs and conversions use their own counters while planning stays unfilled", () => {
  const planning = copy("planning", 1, 0, { phase: "planning" });
  const queued = copy("queued", 1, 0, { status: "queued" });
  const deletion = copy("delete", 2, 0, { kind: "delete", processed: 1 });
  const conversion = copy("convert", 3, 0, { kind: "conversion", progressPercent: 37.5 });
  assert.equal(advanceWorkPillProgress(null, [planning, queued], 4), null);
  assert.equal(advanceWorkPillProgress(null, [planning, deletion], 4).fraction, 0.25);
  assert.equal(advanceWorkPillProgress(null, [conversion], 4).fraction, 0.375);
});
