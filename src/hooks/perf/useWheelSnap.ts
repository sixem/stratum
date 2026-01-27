import type { RefObject } from "react";
import { useEffect } from "react";

const DEFAULT_SNAP_PX = 8;
// Approximate wheel "tick" sizes so large deltas map to multiple row steps.
const LEGACY_TICK_DELTA = 120;
const LINE_TICK_DELTA = 3;
const PAGE_TICK_DELTA = 1;
const PIXEL_TICK_DELTA = 100;

export function useWheelSnap(
  containerRef: RefObject<HTMLElement | null>,
  stepPx: number,
  snapPx = DEFAULT_SNAP_PX,
) {
  useEffect(() => {
    const element = containerRef.current;
    if (!element || !stepPx) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;

      // Some inputs report tiny or legacy deltas; fall back to wheelDelta so each tick moves.
      const legacy = event as WheelEvent & { wheelDeltaY?: number; wheelDelta?: number };
      const legacyDelta = legacy.wheelDeltaY ?? legacy.wheelDelta ?? 0;
      const rawDelta =
        event.deltaY !== 0 ? event.deltaY : legacyDelta ? -legacyDelta : 0;
      const direction = Math.sign(rawDelta);

      if (!direction) return;

      // Own vertical wheel scrolling so each tick snaps a consistent distance.
      event.preventDefault();
      const step = Math.max(1, stepPx);
      // Scale up when inputs send large deltas so fast wheel spins still move quickly.
      const tickDelta = legacyDelta
        ? LEGACY_TICK_DELTA
        : event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_TICK_DELTA
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? PAGE_TICK_DELTA
            : PIXEL_TICK_DELTA;
      const deltaMagnitude = legacyDelta ? Math.abs(legacyDelta) : Math.abs(rawDelta);
      const steps = Math.max(1, Math.round(deltaMagnitude / tickDelta));
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const nextTop = Math.min(
        maxScrollTop,
        Math.max(0, element.scrollTop + direction * step * steps),
      );

      element.scrollTop = Math.round(nextTop);

      if (element.scrollTop <= snapPx) {
        element.scrollTop = 0;
      } else if (maxScrollTop - element.scrollTop <= snapPx) {
        element.scrollTop = maxScrollTop;
      }
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [containerRef, snapPx, stepPx]);
}
