// Keeps scroll position stable across resorting by anchoring to the top visible item.
import { useCallback, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

type ScrollAnchor = {
  key: string;
  path: string;
  offset: number;
};

type UseScrollAnchorOptions<Item> = {
  scrollKey: string;
  items: Item[];
  itemHeight: number;
  itemsPerRow?: number;
  scrollReady: boolean;
  loading: boolean;
  getItemPath: (item: Item) => string | null;
  getItemIndex?: (path: string) => number | null;
  onScrollTopChange: (key: string, scrollTop: number) => void;
};

const ANCHOR_SCROLL_GRACE_MS = 120;

export const useScrollAnchor = <Item>(
  ref: RefObject<HTMLElement | null>,
  {
    scrollKey,
    items,
    itemHeight,
    itemsPerRow = 1,
    scrollReady,
    loading,
    getItemPath,
    getItemIndex,
    onScrollTopChange,
  }: UseScrollAnchorOptions<Item>,
) => {
  const anchorRef = useRef<ScrollAnchor | null>(null);
  const lastScrollAtRef = useRef(0);

  const getAnchorTop = useCallback(() => {
    const anchor = anchorRef.current;
    if (!scrollReady || !anchor || anchor.key !== scrollKey) return null;
    if (items.length === 0 || itemHeight <= 0) return null;
    const index = getItemIndex ? getItemIndex(anchor.path) : null;
    const resolvedIndex =
      index != null ? index : items.findIndex((item) => getItemPath(item) === anchor.path);
    if (resolvedIndex < 0) return null;
    const perRow = Math.max(1, itemsPerRow);
    const rowIndex = Math.floor(resolvedIndex / perRow);
    return rowIndex * itemHeight + anchor.offset;
  }, [
    getItemIndex,
    getItemPath,
    itemHeight,
    items,
    itemsPerRow,
    scrollKey,
    scrollReady,
  ]);

  const captureAnchor = useCallback(
    (scrollTop: number) => {
      if (!scrollReady) return;
      if (items.length === 0 || itemHeight <= 0) return;
      const perRow = Math.max(1, itemsPerRow);
      const rowIndex = Math.max(0, Math.floor(scrollTop / itemHeight));
      const index = Math.min(items.length - 1, rowIndex * perRow);
      const item = items[index];
      if (!item) return;
      const path = getItemPath(item);
      if (!path) return;
      anchorRef.current = {
        key: scrollKey,
        path,
        offset: scrollTop - rowIndex * itemHeight,
      };
    },
    [getItemPath, itemHeight, items, itemsPerRow, scrollKey, scrollReady],
  );

  const handleScrollTopChange = useCallback(
    (key: string, scrollTop: number) => {
      onScrollTopChange(key, scrollTop);
      if (!scrollReady) return;
      lastScrollAtRef.current = performance.now();
      captureAnchor(scrollTop);
    },
    [captureAnchor, onScrollTopChange, scrollReady],
  );

  useLayoutEffect(() => {
    if (!scrollReady || loading) return;
    const element = ref.current;
    if (!element) return;
    if (items.length === 0 || itemHeight <= 0) return;
    if (performance.now() - lastScrollAtRef.current < ANCHOR_SCROLL_GRACE_MS) {
      return;
    }

    const anchor = anchorRef.current;
    if (!anchor || anchor.key !== scrollKey) return;
    const index = getItemIndex ? getItemIndex(anchor.path) : null;
    const resolvedIndex =
      index != null ? index : items.findIndex((item) => getItemPath(item) === anchor.path);
    if (resolvedIndex < 0) return;

    const perRow = Math.max(1, itemsPerRow);
    const rowIndex = Math.floor(resolvedIndex / perRow);
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const targetTop = rowIndex * itemHeight + anchor.offset;
    const nextTop = Math.min(Math.max(0, targetTop), maxScrollTop);
    if (Math.abs(nextTop - element.scrollTop) > 1) {
      element.scrollTop = nextTop;
      onScrollTopChange(scrollKey, nextTop);
    }
  }, [
    getItemIndex,
    getItemPath,
    itemHeight,
    items,
    itemsPerRow,
    loading,
    onScrollTopChange,
    ref,
    scrollKey,
    scrollReady,
  ]);

  return { getAnchorTop, handleScrollTopChange };
};
