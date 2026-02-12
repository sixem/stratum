// Virtual range calculation and visible slicing for the file grid.
import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDynamicOverscan, useVirtualRange } from "@/hooks";
import type { EntryItem } from "@/lib";
import { COMPACT_VIEW_INSET } from "../fileView/constants";

const GRID_OVERSCAN = 3;
const GRID_OVERSCAN_MIN = 1;
const GRID_OVERSCAN_WARMUP_MS = 140;
const GRID_OVERSCAN_BURST_MAX = 8;
const GRID_OVERSCAN_BURST_DECAY_MS = 140;
const GRID_WHEEL_BURST_GAP_MS = 42;
const GRID_WHEEL_DELTA_MIN = 60;

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
  const baseOverscan = useDynamicOverscan({
    resetKey: viewKey,
    base: GRID_OVERSCAN,
    min: GRID_OVERSCAN_MIN,
    warmupMs: GRID_OVERSCAN_WARMUP_MS,
  });
  const [wheelBurstOverscan, setWheelBurstOverscan] = useState(0);
  const wheelBurstOverscanRef = useRef(0);
  const burstTimerRef = useRef<number | null>(null);
  const lastWheelAtRef = useRef(0);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const clearBurst = () => {
      if (burstTimerRef.current != null) {
        window.clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
      if (wheelBurstOverscanRef.current === 0) return;
      wheelBurstOverscanRef.current = 0;
      setWheelBurstOverscan(0);
    };

    const scheduleBurstDecay = () => {
      if (burstTimerRef.current != null) {
        window.clearTimeout(burstTimerRef.current);
      }
      burstTimerRef.current = window.setTimeout(() => {
        burstTimerRef.current = null;
        if (wheelBurstOverscanRef.current === 0) return;
        wheelBurstOverscanRef.current = 0;
        setWheelBurstOverscan(0);
      }, GRID_OVERSCAN_BURST_DECAY_MS);
    };

    const setBurstOverscan = (next: number) => {
      const clamped = Math.max(0, Math.min(GRID_OVERSCAN_BURST_MAX, next));
      if (wheelBurstOverscanRef.current === clamped) return;
      wheelBurstOverscanRef.current = clamped;
      setWheelBurstOverscan(clamped);
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const legacy = event as WheelEvent & { wheelDeltaY?: number; wheelDelta?: number };
      const legacyDelta = legacy.wheelDeltaY ?? legacy.wheelDelta ?? 0;
      const rawDelta =
        event.deltaY !== 0 ? event.deltaY : legacyDelta ? -legacyDelta : 0;
      const absDelta = Math.abs(rawDelta);
      if (!absDelta) return;

      const now = performance.now();
      const deltaT = now - lastWheelAtRef.current;
      lastWheelAtRef.current = now;
      const rapidBurst = deltaT > 0 && deltaT <= GRID_WHEEL_BURST_GAP_MS;
      const significantTick =
        absDelta >= GRID_WHEEL_DELTA_MIN ||
        event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL;

      if (!rapidBurst && !significantTick) return;

      // Scale overscan up during fast wheel bursts to reduce pop-in at the viewport edges.
      let burst = 1;
      if (absDelta >= 480) {
        burst = 5;
      } else if (absDelta >= 320) {
        burst = 4;
      } else if (absDelta >= 200) {
        burst = 3;
      } else if (absDelta >= 120) {
        burst = 2;
      }
      if (rapidBurst && burst < 2) {
        burst = 2;
      }
      setBurstOverscan(burst);
      scheduleBurstDecay();
    };

    element.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      element.removeEventListener("wheel", handleWheel);
      clearBurst();
    };
  }, [viewportRef]);

  // Reset temporary burst overscan when switching views.
  useEffect(() => {
    if (burstTimerRef.current != null) {
      window.clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
    }
    wheelBurstOverscanRef.current = 0;
    setWheelBurstOverscan(0);
    lastWheelAtRef.current = 0;
  }, [viewKey]);

  const overscan = Math.min(
    GRID_OVERSCAN_BURST_MAX,
    Math.max(GRID_OVERSCAN_MIN, baseOverscan + wheelBurstOverscan),
  );
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
