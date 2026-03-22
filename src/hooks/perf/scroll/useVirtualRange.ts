import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type VirtualRange = {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  offsetBottom: number;
  totalHeight: number;
};

type UseVirtualRangeOptions = {
  viewportHeight?: number;
  observeContainerResize?: boolean;
};

export function useVirtualRange(
  containerRef: RefObject<HTMLElement | null>,
  itemCount: number,
  itemHeight: number,
  overscan = 6,
  // Extra scrollable padding before/after the virtualized content.
  insetTop = 0,
  insetBottom = 0,
  { viewportHeight, observeContainerResize = true }: UseVirtualRangeOptions = {},
): VirtualRange {
  const rafRef = useRef<number | null>(null);
  const rangeRef = useRef<VirtualRange>({
    startIndex: 0,
    endIndex: 0,
    offsetTop: 0,
    offsetBottom: 0,
    totalHeight: 0,
  });
  const [range, setRange] = useState(rangeRef.current);

  const updateRange = useCallback(() => {
    const element = containerRef.current;
    if (!element || !itemHeight) {
      const safeInsetTop = Math.max(0, insetTop);
      const safeInsetBottom = Math.max(0, insetBottom);
      const totalHeight =
        Math.max(0, itemCount * itemHeight) + safeInsetTop + safeInsetBottom;
      const fallback: VirtualRange = {
        startIndex: 0,
        endIndex: 0,
        offsetTop: safeInsetTop,
        offsetBottom: totalHeight,
        totalHeight,
      };
      rangeRef.current = fallback;
      setRange(fallback);
      return;
    }

    const resolvedViewportHeight = viewportHeight ?? element.clientHeight;
    const safeInsetTop = Math.max(0, insetTop);
    const safeInsetBottom = Math.max(0, insetBottom);
    const contentHeight = Math.max(0, itemCount * itemHeight);
    const totalHeight = contentHeight + safeInsetTop + safeInsetBottom;
    const maxScrollTop = Math.max(0, totalHeight - resolvedViewportHeight);
    const scrollTop = Math.min(element.scrollTop, maxScrollTop);
    if (element.scrollTop !== scrollTop) {
      element.scrollTop = scrollTop;
    }

    const effectiveScrollTop = Math.max(0, scrollTop - safeInsetTop);
    const startIndex = Math.max(0, Math.floor(effectiveScrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      itemCount,
      Math.ceil((effectiveScrollTop + resolvedViewportHeight) / itemHeight) + overscan,
    );
    const offsetTop = safeInsetTop + startIndex * itemHeight;
    const offsetBottom =
      safeInsetBottom + Math.max(0, contentHeight - endIndex * itemHeight);
    const nextRange: VirtualRange = {
      startIndex,
      endIndex,
      offsetTop,
      offsetBottom,
      totalHeight,
    };

    const prev = rangeRef.current;
    if (
      prev.startIndex === nextRange.startIndex &&
      prev.endIndex === nextRange.endIndex &&
      prev.offsetTop === nextRange.offsetTop &&
      prev.totalHeight === nextRange.totalHeight
    ) {
      return;
    }

    rangeRef.current = nextRange;
    setRange(nextRange);
  }, [containerRef, itemCount, itemHeight, insetBottom, insetTop, overscan, viewportHeight]);

  useLayoutEffect(() => {
    updateRange();
  }, [updateRange]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const scheduleUpdate = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        updateRange();
      });
    };

    const handleScroll = () => {
      scheduleUpdate();
    };

    element.addEventListener("scroll", handleScroll, { passive: true });

    const observer = observeContainerResize
      ? new ResizeObserver(() => scheduleUpdate())
      : null;
    observer?.observe(element);

    return () => {
      element.removeEventListener("scroll", handleScroll);
      observer?.disconnect();
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [containerRef, observeContainerResize, updateRange]);

  return range;
}
