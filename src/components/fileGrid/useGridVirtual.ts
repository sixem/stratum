// Virtual range calculation and visible slicing for the file grid.
import type { RefObject } from "react";
import { useMemo } from "react";
import { useDynamicOverscan, useVirtualRange } from "@/hooks";
import type { EntryItem } from "@/lib";
import { COMPACT_VIEW_INSET } from "../fileView/constants";

const GRID_OVERSCAN = 3;
const GRID_OVERSCAN_MIN = 1;
const GRID_OVERSCAN_WARMUP_MS = 140;

type UseGridVirtualOptions = {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewKey: string;
  columnCount: number;
  rowCount: number;
  rowHeight: number;
  compactMode: boolean;
  viewItems: EntryItem[];
};

export type GridVirtualState = {
  virtual: ReturnType<typeof useVirtualRange>;
  visibleItems: EntryItem[];
  startIndex: number;
  endIndex: number;
};

export const useGridVirtual = ({
  viewportRef,
  viewKey,
  columnCount,
  rowCount,
  rowHeight,
  compactMode,
  viewItems,
}: UseGridVirtualOptions): GridVirtualState => {
  const overscan = useDynamicOverscan({
    resetKey: viewKey,
    base: GRID_OVERSCAN,
    min: GRID_OVERSCAN_MIN,
    warmupMs: GRID_OVERSCAN_WARMUP_MS,
  });
  const viewInset = compactMode ? COMPACT_VIEW_INSET : 0;
  const virtual = useVirtualRange(
    viewportRef,
    rowCount,
    rowHeight,
    overscan,
    viewInset,
    viewInset,
  );
  const startIndex = virtual.startIndex * columnCount;
  const endIndex = Math.min(viewItems.length, virtual.endIndex * columnCount);
  // Memoize the visible slice so selection updates don't rebuild metadata/thumb lists.
  const visibleItems = useMemo(
    () => viewItems.slice(startIndex, endIndex),
    [endIndex, startIndex, viewItems],
  );

  return { virtual, visibleItems, startIndex, endIndex };
};
