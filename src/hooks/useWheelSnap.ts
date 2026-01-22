import type { RefObject } from "react";
import { useEffect } from "react";

const DEFAULT_SNAP_PX = 8;

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
      event.preventDefault();
      const direction = Math.sign(event.deltaY);
      if (!direction) return;
      const step = Math.max(1, stepPx);
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const nextTop = Math.min(maxScrollTop, Math.max(0, element.scrollTop + direction * step));
      element.scrollTop = Math.round(nextTop);
      if (element.scrollTop <= snapPx) {
        element.scrollTop = 0;
      } else if (maxScrollTop - element.scrollTop <= snapPx) {
        element.scrollTop = maxScrollTop;
      }
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [containerRef, stepPx]);
}
