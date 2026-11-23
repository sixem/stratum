import assert from "node:assert/strict";
import test from "node:test";
import { EntryMetaRefreshQueue } from "../src/hooks/domain/filesystem/entryMetaRefreshQueue.ts";

const pathsIn = (batch) => Array.from(batch.entries.values(), ({ path }) => path);
const read = (path, size = 4) => ({ path, size, modified: 1 });

test("drains a bulk change in bounded batches with visible rows first", () => {
  const queue = new EntryMetaRefreshQueue();
  const paths = Array.from({ length: 265 }, (_, i) => `E:\\Work\\file-${i}.mp4`);
  for (const path of paths) queue.invalidate(path);
  const visible = paths.slice(-8);
  queue.setVisible(visible);

  const published = [];
  const batchSizes = [];
  while (queue.ready) {
    const batch = queue.take(120);
    const paths = pathsIn(batch);
    batchSizes.push(paths.length);
    published.push(...queue.complete(batch, paths.map((path) => read(path))).updates.map(({ path }) => path));
  }
  assert.deepEqual(batchSizes, [120, 120, 25]);
  assert.deepEqual(published.slice(0, visible.length), visible);
  assert.deepEqual(new Set(published), new Set(paths));
});

test("listing changes preserve invalidations and discard the earlier stat", () => {
  const queue = new EntryMetaRefreshQueue();
  const path = "E:\\Work\\file.mp4";
  queue.invalidate(path);
  const beforeListing = queue.take(120);
  queue.setListingPending(true);
  assert.equal(queue.ready, false);
  queue.setListingPending(false);

  assert.deepEqual(queue.complete(beforeListing, [read(path, 4)]).updates, []);
  assert.equal(queue.ready, true);
  assert.deepEqual(queue.complete(queue.take(120), [read(path, 9)]).updates, [read(path, 9)]);
  assert.equal(queue.ready, false);
});

test("a file changed during its stat stays queued without publishing the older result", () => {
  const queue = new EntryMetaRefreshQueue();
  const path = "E:\\Work\\file.mp4";
  const other = "E:\\Work\\other.mp4";
  queue.invalidate(path);
  queue.invalidate(other);
  const batch = queue.take(120);
  queue.invalidate(path);

  assert.deepEqual(queue.complete(batch, [read(path), read(other)]).updates, [read(other)]);
  assert.deepEqual(pathsIn(queue.take(120)), [path]);
  assert.deepEqual(queue.complete(queue.take(120), [read(path, 10)]).updates, [read(path, 10)]);
});

test("uses the visible path spelling without merging case-sensitive names", () => {
  const queue = new EntryMetaRefreshQueue();
  const watched = "e:/Work/file.mp4";
  const visible = "E:\\Work\\file.mp4";
  const other = "E:\\Work\\File.mp4";
  queue.invalidate(other);
  queue.invalidate(watched);
  queue.setVisible([visible]);

  const batch = queue.take(120);
  assert.deepEqual(pathsIn(batch), [watched, other]);
  assert.deepEqual(queue.complete(batch, [read(watched), read(other)]).updates, [read(visible), read(other)]);
});

test("a missing stat reply is retried without delaying successful entries indefinitely", () => {
  const queue = new EntryMetaRefreshQueue();
  const path = "E:\\Work\\unavailable.mp4";
  const other = "E:\\Work\\other.mp4";
  queue.invalidate(path);
  queue.invalidate(other);
  const first = queue.complete(queue.take(120), [read(other)]);
  assert.deepEqual(first.updates, [read(other)]);
  assert.equal(first.retry, true);
  assert.equal(queue.complete(queue.take(120), []).retry, true);
  const last = queue.complete(queue.take(120), []);
  assert.deepEqual(last.failedPaths, [path]);
  assert.equal(last.retry, false);
  assert.equal(queue.ready, false);
});
