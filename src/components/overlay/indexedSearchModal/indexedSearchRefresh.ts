// Retain the viewport anchor when swapping in a fresh, bounded set of pages.
import type { IndexedPathMatch } from "@/types";
import {
  INDEXED_SEARCH_RESULT_HEIGHT,
  INDEXED_SEARCH_RESULT_INSET,
  INDEXED_SEARCH_RESULT_STRIDE,
} from "./indexedSearchModalConfig";

export const MAX_REFRESH_PAGES = 4;

export type IndexedSearchRefreshAnchor = {
  path: string;
  selectedPath: string | null;
  offset: number;
  viewportHeight: number;
};

const rowTop = (index: number) => INDEXED_SEARCH_RESULT_INSET + index * INDEXED_SEARCH_RESULT_STRIDE;

export const captureIndexedSearchAnchor = (
  results: IndexedPathMatch[],
  viewport: Pick<HTMLDivElement, "scrollTop" | "clientHeight">,
  selectedIndex: number,
): IndexedSearchRefreshAnchor | null => {
  const { scrollTop, clientHeight } = viewport;
  const firstVisibleIndex = Math.max(0, Math.floor((scrollTop - INDEXED_SEARCH_RESULT_INSET) / INDEXED_SEARCH_RESULT_STRIDE));
  const selectedPath = results[selectedIndex]?.path ?? null;
  // Prefer a selected row when it's visible. Otherwise keep the visible list steady.
  const top = rowTop(selectedIndex);
  const index = selectedPath && top + INDEXED_SEARCH_RESULT_HEIGHT > scrollTop && top < scrollTop + clientHeight
    ? selectedIndex : firstVisibleIndex;
  const path = results[index]?.path;
  return path ? { path, selectedPath, offset: rowTop(index) - scrollTop, viewportHeight: clientHeight } : null;
};

export const hasIndexedSearchAnchor = (
  indexes: ReadonlyMap<string, number>,
  anchor: IndexedSearchRefreshAnchor | null,
) => {
  if (!anchor) return true;
  const index = indexes.get(anchor.path);
  if (index === undefined || (anchor.selectedPath && !indexes.has(anchor.selectedPath))) return false;
  const height = indexes.size * INDEXED_SEARCH_RESULT_STRIDE + 2 * INDEXED_SEARCH_RESULT_INSET;
  return rowTop(index) - anchor.offset + anchor.viewportHeight <= height;
};

export const indexedSearchAnchorScrollTop = (
  indexes: ReadonlyMap<string, number>,
  anchor: IndexedSearchRefreshAnchor | null,
) => {
  if (!anchor) return 0;
  const index = indexes.get(anchor.path);
  if (index !== undefined) return Math.max(0, rowTop(index) - anchor.offset);
  const selected = anchor.selectedPath ? indexes.get(anchor.selectedPath) : undefined;
  return selected === undefined ? 0 : rowTop(selected) - INDEXED_SEARCH_RESULT_INSET;
};
