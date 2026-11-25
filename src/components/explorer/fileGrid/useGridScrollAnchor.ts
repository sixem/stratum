// Keep viewport edges pinned and center the same entry between them on reflow.
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
  contentHeight: number;
  loading: boolean;
};

type UseGridScrollAnchorOptions = GridLayout & {
  viewportRef: RefObject<HTMLDivElement | null>;
};

type ScrollAnchor =
  | { kind: "top" | "bottom"; scrollTop: number }
  | { kind: "entry"; index: number; rowFraction: number; scrollTop: number };

const EDGE_TOLERANCE = 1;

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
  const lastScrollTopRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const rememberScroll = () => { lastScrollTopRef.current = element.scrollTop; };
    rememberScroll();
    element.addEventListener("scroll", rememberScroll, { passive: true });
    return () => element.removeEventListener("scroll", rememberScroll);
  }, [viewportRef]);

  useLayoutEffect(() => {
    const previous = previousLayoutRef.current;
    previousLayoutRef.current = {
      viewKey, scrollRestoreKey, items, columnCount, rowHeight, viewportHeight, contentHeight, loading,
    };

    const element = viewportRef.current;
    const scrollTop = element?.scrollTop ?? 0;
    const previousScrollTop = lastScrollTopRef.current ?? scrollTop;
    lastScrollTopRef.current = scrollTop;
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
        (saved.kind === "entry"
          ? previous.items[saved.index]?.key !== items[saved.index]?.key
          : previous.contentHeight !== contentHeight)
      )) {
        anchorRef.current = null;
      }
      return;
    }

    const clientHeight = element.clientHeight;
    const maxScrollTop = Math.max(0, contentHeight - clientHeight);
    const previousMaxScrollTop = Math.max(0, previous.contentHeight - previous.viewportHeight);
    // The browser can clamp the old offset before we read the resized grid.
    const anchorTop = previousScrollTop > scrollTop && scrollTop >= maxScrollTop - EDGE_TOLERANCE
      ? previousScrollTop : scrollTop;
    const retained = saved?.scrollTop === anchorTop ? saved : null;
    const edge = retained?.kind ?? (
      anchorTop <= EDGE_TOLERANCE ? "top" :
      anchorTop >= previousMaxScrollTop - EDGE_TOLERANCE ? "bottom" :
      "entry"
    );
    if (edge !== "entry") {
      element.scrollTop = edge === "top" ? 0 : maxScrollTop;
      lastScrollTopRef.current = element.scrollTop;
      anchorRef.current = { kind: edge, scrollTop: element.scrollTop };
      return;
    }

    const previousRow = Math.max(0, anchorTop + previous.viewportHeight / 2 - VIEW_INSET) /
      previous.rowHeight;
    const entryAnchor = retained?.kind === "entry" ? retained : null;
    const previousIndex = entryAnchor?.index ?? Math.min(
      previous.items.length - 1,
      Math.floor(previousRow) * previous.columnCount + Math.floor(previous.columnCount / 2),
    );
    const rowFraction = entryAnchor?.rowFraction ?? previousRow % 1;
    const anchorKey = previous.items[previousIndex]?.key;
    const index = items[previousIndex]?.key === anchorKey
      ? previousIndex
      : items.findIndex((item) => item.key === anchorKey);
    if (index < 0) {
      anchorRef.current = null;
      return;
    }

    const center = (Math.floor(index / columnCount) + rowFraction) * rowHeight + VIEW_INSET;
    const target = Math.min(maxScrollTop, Math.max(0, center - clientHeight / 2));
    if (Math.abs(target - scrollTop) > 0.5) element.scrollTop = target;
    lastScrollTopRef.current = element.scrollTop;
    anchorRef.current = { kind: "entry", index, rowFraction, scrollTop: element.scrollTop };
  }, [
    columnCount, contentHeight, items, loading, rowHeight, scrollRestoreKey,
    viewKey, viewportHeight, viewportRef,
  ]);
};
