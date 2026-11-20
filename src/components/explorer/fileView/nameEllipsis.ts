import type { RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { GridNameEllipsis } from "@/modules";
import { makeDebug, splitNameExtension } from "@/lib";

// Keep a chunk of the filename tail visible when middle-ellipsis is enabled.
const NAME_MIN_TAIL_CHARS = 8;
const NAME_BASE_TAIL_CHARS = 9;
const OVERFLOW_LOG_INTERVAL_MS = 1000;
const perf = makeDebug("perf:resize:ellipsis");
const overflowMeasurements = new Map<Element, () => void>();
let overflowObserver: ResizeObserver | undefined;

const overflowPerfState = {
  measures: 0,
  observerCallbacks: 0,
  stateChanges: 0,
  lastLogAt: 0,
};

const flushOverflowPerf = () => {
  if (!perf.enabled) return;
  const now = performance.now();
  if (now - overflowPerfState.lastLogAt < OVERFLOW_LOG_INTERVAL_MS) {
    return;
  }
  overflowPerfState.lastLogAt = now;
  perf(
    "labels active=%d measures=%d callbacks=%d stateChanges=%d",
    overflowMeasurements.size,
    overflowPerfState.measures,
    overflowPerfState.observerCallbacks,
    overflowPerfState.stateChanges,
  );
  overflowPerfState.measures = 0;
  overflowPerfState.observerCallbacks = 0;
  overflowPerfState.stateChanges = 0;
};

// Batch visible filename labels into one resize delivery per layout update.
const observeOverflow = (container: HTMLElement, updateOverflow: () => void) => {
  if (typeof ResizeObserver === "undefined") return;
  const observer = overflowObserver ??= new ResizeObserver((entries) => {
    overflowPerfState.observerCallbacks += 1;
    for (const { target } of entries) {
      overflowMeasurements.get(target)?.();
    }
    flushOverflowPerf();
  });
  overflowMeasurements.set(container, updateOverflow);
  observer.observe(container);
  return () => {
    observer.unobserve(container);
    overflowMeasurements.delete(container);
  };
};

export const buildMiddleEllipsisParts = (name: string) => {
  const { dotExtension } = splitNameExtension(name);
  const tailTarget = Math.max(
    NAME_MIN_TAIL_CHARS,
    (dotExtension?.length ?? 0) + NAME_BASE_TAIL_CHARS,
  );
  const tailLength = Math.min(name.length, tailTarget);
  const headLength = Math.max(0, name.length - tailLength);

  return {
    head: name.slice(0, headLength),
    tail: name.slice(headLength),
  };
};

// Tracks whether a label actually overflows so middle-ellipsis only kicks in when needed.
export const useOverflowEllipsis = (
  text: string,
  mode: GridNameEllipsis,
  containerRef: RefObject<HTMLElement | null>,
  measureRef: RefObject<HTMLElement | null>,
) => {
  const [isOverflowing, setIsOverflowing] = useState(false);
  const overflowRef = useRef(false);

  useLayoutEffect(() => {
    const commitOverflow = (next: boolean) => {
      if (overflowRef.current === next) return;
      overflowRef.current = next;
      overflowPerfState.stateChanges += 1;
      setIsOverflowing(next);
    };

    if (mode !== "middle") {
      commitOverflow(false);
      return;
    }

    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const updateOverflow = () => {
      overflowPerfState.measures += 1;
      commitOverflow(measure.offsetWidth > container.clientWidth + 1);
    };

    updateOverflow();
    return observeOverflow(container, updateOverflow);
  }, [containerRef, measureRef, mode, text]);

  const parts =
    mode === "middle" && isOverflowing ? buildMiddleEllipsisParts(text) : null;
  const useMiddleEllipsis = Boolean(parts && parts.head.length > 0);

  return {
    parts,
    useMiddleEllipsis,
    renderMode: useMiddleEllipsis ? "middle" : "end",
  } as const;
};
