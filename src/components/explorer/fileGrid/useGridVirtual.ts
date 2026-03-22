// Virtual range calculation and visible slicing for the file grid.
import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDynamicOverscan, useVirtualRange } from "@/hooks";
import { makeDebug } from "@/lib";
import type { EntryItem } from "@/lib";
import { VIEW_INSET } from "../fileView/constants";

const GRID_OVERSCAN = 3;
const GRID_OVERSCAN_MIN = 1;
const GRID_OVERSCAN_WARMUP_MS = 140;
const GRID_OVERSCAN_BURST_MAX = 8;
const GRID_OVERSCAN_BURST_DECAY_MS = 140;
const GRID_WHEEL_BURST_GAP_MS = 42;
const GRID_WHEEL_DELTA_MIN = 60;
const perf = makeDebug("perf:resize:virtual");

type UseGridVirtualOptions = {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportHeight: number;
  viewKey: string;
  columnCount: number;
  rowCount: number;
  rowHeight: number;
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
  viewportHeight,
  viewKey,
  columnCount,
  rowCount,
  rowHeight,
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
  const lastVirtualLogRef = useRef("");

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
  const virtual = useVirtualRange(
    viewportRef,
    rowCount,
    rowHeight,
    overscan,
    VIEW_INSET,
    VIEW_INSET,
    {
      viewportHeight,
      observeContainerResize: false,
    },
  );
  const startIndex = virtual.startIndex * columnCount;
  const endIndex = Math.min(viewItems.length, virtual.endIndex * columnCount);
  // Memoize the visible slice so selection updates don't rebuild metadata/thumb lists.
  const visibleItems = useMemo(
    () => viewItems.slice(startIndex, endIndex),
    [endIndex, startIndex, viewItems],
  );

  useEffect(() => {
    if (!perf.enabled) return;
    const snapshot = [
      viewKey,
      columnCount,
      rowCount,
      rowHeight,
      overscan,
      startIndex,
      endIndex,
      visibleItems.length,
      viewItems.length,
    ].join(":");
    if (lastVirtualLogRef.current === snapshot) return;
    lastVirtualLogRef.current = snapshot;
    perf(
      "window view=%s cols=%d rows=%d rowHeight=%d overscan=%d visible=%d range=%d-%d total=%d",
      viewKey,
      columnCount,
      rowCount,
      rowHeight,
      overscan,
      visibleItems.length,
      startIndex,
      endIndex,
      viewItems.length,
    );
  }, [
    columnCount,
    endIndex,
    overscan,
    rowCount,
    rowHeight,
    startIndex,
    viewItems.length,
    viewKey,
    visibleItems.length,
  ]);

  return { virtual, visibleItems, startIndex, endIndex };
};
