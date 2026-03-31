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
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [overflowed, setOverflowed] = useState(false);

  const updateScrollState = useCallback(() => {
    const container = containerRef.current;
    if (!enabled || !container) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      setOverflowed(false);
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = container;
    const hasOverflow = scrollWidth > clientWidth + overflowThreshold;
    setOverflowed(hasOverflow);
    setCanScrollLeft(hasOverflow && scrollLeft > 0);
    setCanScrollRight(hasOverflow && scrollLeft + clientWidth < scrollWidth - overflowThreshold);
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

    const handleScroll = () => updateScrollState();
    container.addEventListener("scroll", handleScroll, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => updateScrollState());

    resizeObserver?.observe(container);

    if (resizeObserver && observeSelector) {
      Array.from(container.querySelectorAll<HTMLElement>(observeSelector)).forEach((element) => {
        resizeObserver.observe(element);
      });
    }

    window.addEventListener("resize", updateScrollState);
    updateScrollState();

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScrollState);
    };
  }, [enabled, observeSelector, refreshKey, updateScrollState]);

  return {
    canScrollLeft,
    canScrollRight,
    overflowed,
    scrollByDirection,
    updateScrollState,
  };
}
