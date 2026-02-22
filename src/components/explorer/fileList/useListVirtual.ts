// Virtual range calculation for the list view.
import type { RefObject } from "react";
import { useMemo } from "react";
import { useDynamicOverscan, useVirtualRange } from "@/hooks";
import type { EntryItem } from "@/lib";
import { VIEW_INSET } from "../fileView/constants";

const OVERSCAN = 10;
const OVERSCAN_MIN = 2;
const OVERSCAN_WARMUP_MS = 140;

type UseListVirtualOptions = {
  listRef: RefObject<HTMLDivElement | null>;
  viewKey: string;
  itemHeight: number;
  rows: EntryItem[];
};

type ListVirtualState = {
  virtual: ReturnType<typeof useVirtualRange>;
  visibleRows: EntryItem[];
};

export const useListVirtual = ({
  listRef,
  viewKey,
  itemHeight,
  rows,
}: UseListVirtualOptions): ListVirtualState => {
  const overscan = useDynamicOverscan({
    resetKey: viewKey,
    base: OVERSCAN,
    min: OVERSCAN_MIN,
    warmupMs: OVERSCAN_WARMUP_MS,
  });
  const virtual = useVirtualRange(
    listRef,
    rows.length,
    itemHeight,
    overscan,
    VIEW_INSET,
    VIEW_INSET,
  );
  // Memoize the visible slice so selection drags don't rebuild row metadata.
  const visibleRows = useMemo(
    () => rows.slice(virtual.startIndex, virtual.endIndex),
    [rows, virtual.endIndex, virtual.startIndex],
  );

  return { virtual, visibleRows };
};
