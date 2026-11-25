// Locate the refreshed viewport using rows from the previous result set.
import type { IndexedPathMatch } from "@/types";
import {
  INDEXED_SEARCH_PAGE_SIZE,
  INDEXED_SEARCH_RESULT_HEIGHT,
  INDEXED_SEARCH_RESULT_INSET,
  INDEXED_SEARCH_RESULT_STRIDE,
} from "./indexedSearchModalConfig.ts";

const REFRESH_LOOKAHEAD_ROWS = 2 * INDEXED_SEARCH_PAGE_SIZE;

type AnchorRow = { path: string; offset: number };

export type IndexedSearchRefreshAnchor = {
  row: AnchorRow;
  nearby: AnchorRow[];
  selectedPath: string | null;
  scrollTop: number;
  viewportHeight: number;
  rowsToCover: number;
};

export type IndexedSearchScrollRestore = { top: number; path?: string };

const rowTop = (index: number) => INDEXED_SEARCH_RESULT_INSET + index * INDEXED_SEARCH_RESULT_STRIDE;
const listHeight = (count: number) => count * INDEXED_SEARCH_RESULT_STRIDE + 2 * INDEXED_SEARCH_RESULT_INSET;
const indexAtTop = (scrollTop: number) => Math.max(0, Math.floor((scrollTop - INDEXED_SEARCH_RESULT_INSET) / INDEXED_SEARCH_RESULT_STRIDE));

export const captureIndexedSearchAnchor = (
  results: IndexedPathMatch[],
  viewport: Pick<HTMLDivElement, "scrollTop" | "clientHeight">,
  selectedIndex: number,
): IndexedSearchRefreshAnchor | null => {
  if (!results.length) return null;
  const { scrollTop, clientHeight } = viewport;
  const firstVisibleIndex = Math.min(results.length - 1, indexAtTop(scrollTop));
  const visibleEnd = Math.min(results.length, indexAtTop(scrollTop + clientHeight) + 1);
  const selectedPath = results[selectedIndex]?.path ?? null;
  // Prefer a selected row when it's visible. Otherwise keep the visible list steady.
  const top = rowTop(selectedIndex);
  const index = selectedPath && top + INDEXED_SEARCH_RESULT_HEIGHT > scrollTop && top < scrollTop + clientHeight
    ? selectedIndex : firstVisibleIndex;
  const row = (at: number): AnchorRow => ({ path: results[at].path, offset: rowTop(at) - scrollTop });

  // Keep nearby rows as fallbacks, preferring the next row when distances tie.
  const nearby: AnchorRow[] = [];
  const start = Math.max(0, firstVisibleIndex - 1);
  const end = Math.min(results.length, visibleEnd + 1);
  for (let distance = 1; index + distance < end || index - distance >= start; distance += 1) {
    if (index + distance < end) nearby.push(row(index + distance));
    if (index - distance >= start) nearby.push(row(index - distance));
  }
  return {
    row: row(index), nearby, selectedPath, scrollTop, viewportHeight: clientHeight,
    rowsToCover: Math.max(visibleEnd, selectedIndex + 1),
  };
};

export const canFinishIndexedSearchRefresh = (
  indexes: ReadonlyMap<string, number>,
  anchor: IndexedSearchRefreshAnchor | null,
) => {
  if (!anchor) return true;
  const index = indexes.get(anchor.row.path);
  if (index !== undefined) {
    const viewportEnd = Math.max(0, rowTop(index) - anchor.row.offset) + anchor.viewportHeight;
    if (viewportEnd > listHeight(indexes.size)) return false;
    if (!anchor.selectedPath || indexes.has(anchor.selectedPath)) return true;
  }
  // Search past the previous viewport for shifted rows without walking the
  // entire catalog when the old matches have disappeared.
  return indexes.size >= anchor.rowsToCover + REFRESH_LOOKAHEAD_ROWS;
};

export const restoreIndexedSearchAnchor = (
  results: readonly IndexedPathMatch[],
  indexes: ReadonlyMap<string, number>,
  anchor: IndexedSearchRefreshAnchor | null,
): IndexedSearchScrollRestore => {
  if (!anchor) return { top: 0 };
  const maxScroll = Math.max(0, listHeight(results.length) - anchor.viewportHeight);
  const clampScroll = (top: number) => Math.max(0, Math.min(top, maxScroll));
  for (const row of [anchor.row, ...anchor.nearby]) {
    const index = indexes.get(row.path);
    if (index !== undefined) return { top: clampScroll(rowTop(index) - row.offset), path: row.path };
  }
  const top = clampScroll(anchor.scrollTop);
  return { top, path: results[indexAtTop(top)]?.path };
};
