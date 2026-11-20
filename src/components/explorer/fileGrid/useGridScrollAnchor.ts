// Keep the same entry near the viewport center when the grid reflows.
import type { RefObject } from "react";
import { useLayoutEffect, useRef } from "react";
import type { EntryItem } from "@/lib";
import { VIEW_INSET } from "../fileView/constants";

type GridLayout = {
  viewKey: string;
  scrollRestoreKey: string;
  items: EntryItem[];
  columnCount: number;
  rowHeight: number;
  viewportHeight: number;
  loading: boolean;
};

type UseGridScrollAnchorOptions = GridLayout & {
  viewportRef: RefObject<HTMLDivElement | null>;
  contentHeight: number;
};

type ScrollAnchor = {
  index: number;
  rowFraction: number;
  scrollTop: number;
};

export const useGridScrollAnchor = ({
  viewportRef,
  viewKey,
  scrollRestoreKey,
  items,
  columnCount,
  rowHeight,
  viewportHeight,
  contentHeight,
  loading,
}: UseGridScrollAnchorOptions) => {
  const previousLayoutRef = useRef<GridLayout | null>(null);
  const anchorRef = useRef<ScrollAnchor | null>(null);

  useLayoutEffect(() => {
    const previous = previousLayoutRef.current;
    previousLayoutRef.current = {
      viewKey, scrollRestoreKey, items, columnCount, rowHeight, viewportHeight, loading,
    };

    const element = viewportRef.current;
    if (
      !element || !previous || loading || previous.loading ||
      previous.viewKey !== viewKey || previous.scrollRestoreKey !== scrollRestoreKey ||
      previous.items.length === 0 || items.length === 0 ||
      previous.viewportHeight <= 0 || viewportHeight <= 0
    ) {
      anchorRef.current = null;
      return;
    }

    const saved = anchorRef.current;
    if (previous.columnCount === columnCount && previous.rowHeight === rowHeight) {
      if (saved && (
        previous.viewportHeight !== viewportHeight ||
        previous.items[saved.index]?.key !== items[saved.index]?.key
      )) {
        anchorRef.current = null;
      }
      return;
    }

    const scrollTop = element.scrollTop;
    // Reuse the exact entry across consecutive reflows until the user scrolls.
    const retained = saved?.scrollTop === scrollTop ? saved : null;
    if (!retained && scrollTop === 0) {
      anchorRef.current = null;
      return;
    }

    const previousRow = Math.max(0, scrollTop + previous.viewportHeight / 2 - VIEW_INSET) /
      previous.rowHeight;
    const previousIndex = retained?.index ?? Math.min(
      previous.items.length - 1,
      Math.floor(previousRow) * previous.columnCount + Math.floor(previous.columnCount / 2),
    );
    const rowFraction = retained?.rowFraction ?? previousRow % 1;
    const anchorKey = previous.items[previousIndex]?.key;
    const index = items[previousIndex]?.key === anchorKey
      ? previousIndex
      : items.findIndex((item) => item.key === anchorKey);
    if (index < 0) {
      anchorRef.current = null;
      return;
    }

    const clientHeight = element.clientHeight;
    const center = (Math.floor(index / columnCount) + rowFraction) * rowHeight + VIEW_INSET;
    const maxScrollTop = Math.max(0, contentHeight - clientHeight);
    const target = Math.min(maxScrollTop, Math.max(0, center - clientHeight / 2));
    if (Math.abs(target - scrollTop) > 0.5) element.scrollTop = target;
    anchorRef.current = { index, rowFraction, scrollTop: element.scrollTop };
  }, [
    columnCount, contentHeight, items, loading, rowHeight, scrollRestoreKey,
    viewKey, viewportHeight, viewportRef,
  ]);
};
