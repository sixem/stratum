// Let a vertical mouse wheel move a horizontal strip when it can scroll.
import { useEffect } from "react";
import type { RefObject } from "react";

const WHEEL_LINE_PIXELS = 16;

export function useHorizontalWheelScroll(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || !event.cancelable) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      // Read deltaMode first because browsers can report wheel units on demand.
      const { deltaMode, deltaX, deltaY } = event;
      if (Math.abs(deltaY) <= Math.abs(deltaX)) return;
      const { scrollLeft, scrollWidth, clientWidth } = element;
      const maxScrollLeft = scrollWidth - clientWidth;
      if (maxScrollLeft <= 0) return;

      const unit = deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PIXELS
        : deltaMode === WheelEvent.DOM_DELTA_PAGE ? clientWidth
        : 1;
      const target = Math.min(maxScrollLeft, Math.max(0, scrollLeft + deltaY * unit));
      if (target === scrollLeft) return;

      event.preventDefault();
      element.scrollTo({ left: target, behavior: "instant" });
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [enabled, ref]);
}
