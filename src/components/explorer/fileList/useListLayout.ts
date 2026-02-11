// Layout sizing and scroll restoration for the list view.
import type { CSSProperties, RefObject } from "react";
import { useMemo, useRef } from "react";
import { useScrollRestore, useWheelSnap } from "@/hooks";

const ROW_HEIGHT = 48;
const ROW_GAP = 8;
const COMPACT_ROW_HEIGHT = 36;
const COMPACT_ROW_GAP = 6;

type UseListLayoutOptions = {
  compactMode: boolean;
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

export const useListLayout = ({
  compactMode,
  smoothScroll,
  scrollRestoreKey,
  scrollRestoreTop,
  loading,
}: UseListLayoutOptions): ListLayoutState => {
  const listRef = useRef<HTMLDivElement | null>(null);
  // Match virtualization height with compact spacing when enabled.
  const rowHeight = compactMode ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
  const rowGap = compactMode ? COMPACT_ROW_GAP : ROW_GAP;
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

  return { listRef, rowHeight, rowGap, itemHeight, listVars };
};
