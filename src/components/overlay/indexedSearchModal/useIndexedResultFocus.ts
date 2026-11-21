// Reveal rows by their virtual position before asking React to focus a mounted row.
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { INDEXED_SEARCH_RESULT_HEIGHT, INDEXED_SEARCH_RESULT_INSET, INDEXED_SEARCH_RESULT_STRIDE } from "./indexedSearchModalConfig";

export const useIndexedResultFocus = (viewportRef: RefObject<HTMLDivElement | null>) => {
  const rowsRef = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusRef = useRef<string | null>(null);

  const registerResultRow = useCallback((path: string, row: HTMLButtonElement | null) => {
    if (!row) {
      rowsRef.current.delete(path);
      return;
    }
    rowsRef.current.set(path, row);
    if (pendingFocusRef.current === path) {
      pendingFocusRef.current = null;
      row.focus({ preventScroll: true });
    }
  }, []);

  const revealResult = useCallback((path: string, index: number, focus: boolean) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const top = INDEXED_SEARCH_RESULT_INSET + index * INDEXED_SEARCH_RESULT_STRIDE;
    const bottom = top + INDEXED_SEARCH_RESULT_HEIGHT;
    if (top < viewport.scrollTop) {
      viewport.scrollTop = Math.max(0, top - INDEXED_SEARCH_RESULT_INSET);
    } else if (bottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = bottom - viewport.clientHeight + INDEXED_SEARCH_RESULT_INSET;
    }

    pendingFocusRef.current = null;
    if (!focus) return;
    const row = rowsRef.current.get(path);
    if (row) row.focus({ preventScroll: true });
    else pendingFocusRef.current = path;
  }, [viewportRef]);

  return { registerResultRow, revealResult };
};
