// Layout sizing and scroll restoration for the list view.
import type { CSSProperties, RefObject } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useScrollRestore, useWheelSnap } from "@/hooks";
import type { ListDensity } from "@/modules/settings.types";
import { VIEW_INSET } from "../fileView/constants";
import { getFileViewLayoutMetrics } from "../fileViewLayoutMetrics";

type UseListLayoutOptions = {
  density: ListDensity;
  smoothScroll: boolean;
  scrollRestoreKey: string;
  scrollRestoreTop: number;
  loading: boolean;
};

type ListLayoutState = {
  listRef: RefObject<HTMLDivElement | null>;
  rowHeight: number;
  rowGap: number;
  itemHeight: number;
  listVars: CSSProperties;
};

type ListScrollAnchor = {
  key: string;
  itemHeight: number;
  top: number;
  pinnedToEnd: boolean;
};

export const useListLayout = ({
  density,
  smoothScroll,
  scrollRestoreKey,
  scrollRestoreTop,
  loading,
}: UseListLayoutOptions): ListLayoutState => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollAnchorRef = useRef<ListScrollAnchor | null>(null);
  const layoutMetrics = useMemo(() => getFileViewLayoutMetrics(), []);
  const rowHeight = density === "compact" ? layoutMetrics.listCompactRowHeight : layoutMetrics.listRowHeight;
  const rowGap = layoutMetrics.listRowGap;
  const itemHeight = rowHeight + rowGap;

  const listVars = useMemo(
    () =>
      ({
        "--list-row-height": `${rowHeight}px`,
        "--list-row-gap": `${rowGap}px`,
      }) as CSSProperties,
    [rowGap, rowHeight],
  );

  // When smooth scrolling is disabled, snap wheel input to a single row.
  useWheelSnap(listRef, smoothScroll ? 0 : itemHeight);
  // Restore the stored scroll offset once the list height is ready.
  useScrollRestore(listRef, {
    restoreKey: scrollRestoreKey,
    restoreTop: scrollRestoreTop,
    restoreReady: !loading,
  });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || loading) {
      scrollAnchorRef.current = null;
      return;
    }
    const anchor = scrollAnchorRef.current;
    // A density change should keep the same leading row visible. Save the
    // original offset before the browser can clamp it to the new list height.
    if (anchor?.key === scrollRestoreKey && anchor.itemHeight !== itemHeight) {
      list.scrollTop = anchor.pinnedToEnd
        ? list.scrollHeight - list.clientHeight
        : Math.min(anchor.top, VIEW_INSET) + Math.max(0, anchor.top - VIEW_INSET) * itemHeight / anchor.itemHeight;
    }
    const rememberScroll = () => {
      scrollAnchorRef.current = {
        key: scrollRestoreKey,
        itemHeight,
        top: list.scrollTop,
        pinnedToEnd: list.scrollTop > 0 && list.scrollTop >= list.scrollHeight - list.clientHeight - 1,
      };
    };
    rememberScroll();
    list.addEventListener("scroll", rememberScroll, { passive: true });
    return () => list.removeEventListener("scroll", rememberScroll);
  }, [itemHeight, loading, scrollRestoreKey]);

  return { listRef, rowHeight, rowGap, itemHeight, listVars };
};
