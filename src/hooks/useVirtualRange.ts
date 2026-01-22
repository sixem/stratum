import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type VirtualRange = {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  offsetBottom: number;
  totalHeight: number;
};

export function useVirtualRange(
  containerRef: RefObject<HTMLElement | null>,
  itemCount: number,
  itemHeight: number,
  overscan = 6,
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
      const totalHeight = Math.max(0, itemCount * itemHeight);
      const fallback: VirtualRange = {
        startIndex: 0,
        endIndex: 0,
        offsetTop: 0,
        offsetBottom: totalHeight,
        totalHeight,
      };
      rangeRef.current = fallback;
      setRange(fallback);
      return;
    }

    const viewportHeight = element.clientHeight;
    const totalHeight = Math.max(0, itemCount * itemHeight);
    const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
    const scrollTop = Math.min(element.scrollTop, maxScrollTop);
    if (element.scrollTop !== scrollTop) {
      element.scrollTop = scrollTop;
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      itemCount,
      Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan,
    );
    const offsetTop = startIndex * itemHeight;
    const offsetBottom = Math.max(0, totalHeight - endIndex * itemHeight);
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
  }, [containerRef, itemCount, itemHeight, overscan]);

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

    const observer = new ResizeObserver(() => scheduleUpdate());
    observer.observe(element);

    return () => {
      element.removeEventListener("scroll", handleScroll);
      observer.disconnect();
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [containerRef, updateRange]);

  return range;
}
