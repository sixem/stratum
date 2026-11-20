import type { RefObject } from "react";
import { useCallback, useEffect, useState } from "react";

type UseHorizontalOverflowScrollOptions = {
  enabled?: boolean;
  observeSelector?: string;
  refreshKey?: unknown;
  overflowThreshold?: number;
  scrollStepMin?: number;
  scrollStepRatio?: number;
};

type HorizontalOverflowScrollState = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  overflowed: boolean;
  scrollByDirection: (direction: "left" | "right") => void;
  updateScrollState: () => void;
};

const NO_OVERFLOW = { canScrollLeft: false, canScrollRight: false, overflowed: false };

// Tracks horizontal overflow affordances for compact strips like tabs and picker rows.
// The hook keeps scroll state, resize observation, and stepped chevron scrolling together.
export function useHorizontalOverflowScroll<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  {
    enabled = true,
    observeSelector,
    refreshKey,
    overflowThreshold = 1,
    scrollStepMin = 220,
    scrollStepRatio = 0.6,
  }: UseHorizontalOverflowScrollOptions = {},
): HorizontalOverflowScrollState {
  const [overflow, setOverflow] = useState(NO_OVERFLOW);

  const updateScrollState = useCallback(() => {
    const container = containerRef.current;
    if (!enabled || !container) {
      setOverflow(NO_OVERFLOW);
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = container;
    const overflowed = scrollWidth > clientWidth + overflowThreshold;
    const canScrollLeft = overflowed && scrollLeft > 0;
    const canScrollRight = overflowed && scrollLeft + clientWidth < scrollWidth - overflowThreshold;
    setOverflow((previous) => {
      if (
        previous.overflowed === overflowed &&
        previous.canScrollLeft === canScrollLeft &&
        previous.canScrollRight === canScrollRight
      ) {
        return previous;
      }
      return { canScrollLeft, canScrollRight, overflowed };
    });
  }, [containerRef, enabled, overflowThreshold]);

  const scrollByDirection = useCallback(
    (direction: "left" | "right") => {
      const container = containerRef.current;
      if (!enabled || !container) return;

      const amount = Math.max(scrollStepMin, container.clientWidth * scrollStepRatio);
      container.scrollBy({
        left: direction === "left" ? -amount : amount,
        behavior: "smooth",
      });
    },
    [containerRef, enabled, scrollStepMin, scrollStepRatio],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) {
      updateScrollState();
      return;
    }

    // One layout read covers both scroll and resize notifications for this frame.
    let frame: number | null = null;
    const scheduleUpdate = () => {
      if (frame != null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateScrollState();
      });
    };
    container.addEventListener("scroll", scheduleUpdate, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);

    resizeObserver?.observe(container);

    if (resizeObserver && observeSelector) {
      Array.from(container.querySelectorAll<HTMLElement>(observeSelector)).forEach((element) => {
        resizeObserver.observe(element);
      });
    }

    window.addEventListener("resize", scheduleUpdate);
    updateScrollState();

    return () => {
      container.removeEventListener("scroll", scheduleUpdate);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [enabled, observeSelector, refreshKey, updateScrollState]);

  return {
    ...overflow,
    scrollByDirection,
    updateScrollState,
  };
}
