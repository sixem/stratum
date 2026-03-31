import type { RefObject } from "react";
import { useLayoutEffect, useState } from "react";
import type { GridNameEllipsis } from "@/modules";
import { makeDebug, splitNameExtension } from "@/lib";

// Keep a chunk of the filename tail visible when middle-ellipsis is enabled.
const NAME_MIN_TAIL_CHARS = 8;
const NAME_BASE_TAIL_CHARS = 9;
const OVERFLOW_LOG_INTERVAL_MS = 1000;
const perf = makeDebug("perf:resize:ellipsis");

const overflowPerfState = {
  activeObservers: 0,
  measures: 0,
  observerCallbacks: 0,
  stateChanges: 0,
  lastLogAt: 0,
};

const flushOverflowPerf = (force = false) => {
  if (!perf.enabled) return;
  const now = performance.now();
  if (!force && now - overflowPerfState.lastLogAt < OVERFLOW_LOG_INTERVAL_MS) {
    return;
  }
  overflowPerfState.lastLogAt = now;
  perf(
    "labels active=%d measures=%d callbacks=%d stateChanges=%d",
    overflowPerfState.activeObservers,
    overflowPerfState.measures,
    overflowPerfState.observerCallbacks,
    overflowPerfState.stateChanges,
  );
  overflowPerfState.measures = 0;
  overflowPerfState.observerCallbacks = 0;
  overflowPerfState.stateChanges = 0;
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

  useLayoutEffect(() => {
    if (mode !== "middle") {
      setIsOverflowing(false);
      return;
    }

    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const updateOverflow = () => {
      overflowPerfState.measures += 1;
      const nextOverflow = measure.offsetWidth > container.clientWidth + 1;
      setIsOverflowing((prev) => {
        if (prev !== nextOverflow) {
          overflowPerfState.stateChanges += 1;
        }
        return prev === nextOverflow ? prev : nextOverflow;
      });
      flushOverflowPerf();
    };

    updateOverflow();
    if (typeof ResizeObserver === "undefined") return;

    overflowPerfState.activeObservers += 1;
    flushOverflowPerf(true);
    const observer = new ResizeObserver(() => {
      overflowPerfState.observerCallbacks += 1;
      updateOverflow();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      overflowPerfState.activeObservers = Math.max(0, overflowPerfState.activeObservers - 1);
      flushOverflowPerf(true);
    };
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
