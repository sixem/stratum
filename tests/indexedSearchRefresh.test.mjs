import assert from "node:assert/strict";
import test from "node:test";
import { indexedResultLookup } from "../src/components/overlay/indexedSearchModal/indexedResultLookup.ts";
import {
  canFinishIndexedSearchRefresh,
  captureIndexedSearchAnchor,
  restoreIndexedSearchAnchor,
} from "../src/components/overlay/indexedSearchModal/indexedSearchRefresh.ts";
import {
  INDEXED_SEARCH_PAGE_SIZE as pageSize,
  INDEXED_SEARCH_RESULT_INSET as inset,
  INDEXED_SEARCH_RESULT_STRIDE as stride,
} from "../src/components/overlay/indexedSearchModal/indexedSearchModalConfig.ts";

const entries = (count, prefix = "entry") => Array.from({ length: count }, (_, index) => {
  const name = `${prefix}-${index}.txt`;
  return { path: `C:\\${name}`, name, kind: "file" };
});
const indexes = (results) => new Map(results.map(({ path }, index) => [path, index]));
const viewportAt = (index) => ({ scrollTop: inset + index * stride - 20, clientHeight: 250 });

test("appending a page preserves the index visible to the previous render", () => {
  const indexes = new Map([["a", 0]]);
  const first = indexedResultLookup(indexes, 1);
  indexes.set("b", 1);
  const second = indexedResultLookup(indexes, 2);
  assert.equal(first.get("a"), 0);
  assert.equal(first.has("b"), false);
  assert.equal(second.get("b"), 1);
});

test("refresh reads far enough to restore a selected row beyond four pages", () => {
  const previous = entries(8 * pageSize);
  const selectedIndex = 6 * pageSize;
  const viewport = viewportAt(selectedIndex);
  const anchor = captureIndexedSearchAnchor(previous, viewport, selectedIndex);
  const refreshed = [...entries(11, "new"), ...previous];

  assert.equal(canFinishIndexedSearchRefresh(indexes(refreshed.slice(0, 4 * pageSize)), anchor), false);
  assert.equal(canFinishIndexedSearchRefresh(indexes(refreshed.slice(0, selectedIndex + 12)), anchor), false);
  assert.equal(canFinishIndexedSearchRefresh(indexes(refreshed), anchor), true);
  assert.deepEqual(restoreIndexedSearchAnchor(refreshed, indexes(refreshed), anchor), {
    top: viewport.scrollTop + 11 * stride,
    path: previous[selectedIndex].path,
  });
});

test("a removed anchor falls back to the next surviving row at its original offset", () => {
  const previous = entries(8 * pageSize);
  const selectedIndex = 5 * pageSize;
  const viewport = viewportAt(selectedIndex);
  const anchor = captureIndexedSearchAnchor(previous, viewport, selectedIndex);
  const refreshed = previous.filter((_, index) => index !== selectedIndex);

  assert.equal(canFinishIndexedSearchRefresh(indexes(refreshed.slice(0, selectedIndex)), anchor), false);
  assert.equal(canFinishIndexedSearchRefresh(indexes(refreshed), anchor), true);
  assert.deepEqual(restoreIndexedSearchAnchor(refreshed, indexes(refreshed), anchor), {
    top: viewport.scrollTop - stride,
    path: previous[selectedIndex + 1].path,
  });
});

test("a fully replaced viewport retains its depth and shorter results clamp to the end", () => {
  const previous = entries(8 * pageSize);
  const viewport = viewportAt(5 * pageSize);
  const anchor = captureIndexedSearchAnchor(previous, viewport, -1);
  const replaced = entries(previous.length, "replacement");
  const short = replaced.slice(0, pageSize);

  assert.equal(restoreIndexedSearchAnchor(replaced, indexes(replaced), anchor).top, viewport.scrollTop);
  assert.equal(restoreIndexedSearchAnchor(short, indexes(short), anchor).top, pageSize * stride + 2 * inset - viewport.clientHeight);
});
