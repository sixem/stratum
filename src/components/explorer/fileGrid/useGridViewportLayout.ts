// Centralizes viewport measurement for the thumbnail grid so sizing and
// virtualization can react to the same width/height snapshot.
import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GridSize } from "@/modules";

const AUTO_GRID_RESIZE_DEBOUNCE_MS = 180;

type ViewportSize = {
  width: number;
  height: number;
};

type UseGridViewportLayoutOptions = {
  gridSize: GridSize;
  autoViewportWidth?: number;
  instantResizeKey?: string | number | boolean;
  viewKey: string;
  onAutoViewportWidthChange?: (width: number) => void;
};

export type GridViewportLayoutState = {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportWidth: number;
  viewportHeight: number;
  stableViewportWidth: number;
  isResizing: boolean;
};

export const useGridViewportLayout = ({
  gridSize,
  autoViewportWidth,
  instantResizeKey,
  viewKey,
  onAutoViewportWidthChange,
}: UseGridViewportLayoutOptions): GridViewportLayoutState => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [stableViewportWidth, setStableViewportWidth] = useState(() => autoViewportWidth ?? 0);
  const [isResizing, setIsResizing] = useState(false);
  const viewportSizeRef = useRef(viewportSize);
  const stableViewportWidthRef = useRef(stableViewportWidth);
  const resizeDebounceRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const resizingRef = useRef(false);

  const commitViewportSize = (width: number, height: number) => {
    const current = viewportSizeRef.current;
    if (current.width === width && current.height === height) return;
    const next = { width, height };
    viewportSizeRef.current = next;
    setViewportSize(next);
  };

  const commitStableViewportWidth = (width: number) => {
    if (stableViewportWidthRef.current === width) return;
    stableViewportWidthRef.current = width;
    setStableViewportWidth(width);
  };

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const measure = () => {
      commitViewportSize(element.clientWidth, element.clientHeight);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const markResizeStart = () => {
      if (resizingRef.current) return;
      resizingRef.current = true;
      setIsResizing(true);
    };

    const markResizeStop = () => {
      resizingRef.current = false;
      setIsResizing(false);
      resizeTimerRef.current = null;
    };

    const handleWindowResize = () => {
      markResizeStart();
      if (resizeTimerRef.current != null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(markResizeStop, AUTO_GRID_RESIZE_DEBOUNCE_MS);
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      if (resizeTimerRef.current != null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const viewportWidth = viewportSize.width;
    if (gridSize === "auto" && viewportWidth <= 0) {
      return;
    }

    if (gridSize !== "auto") {
      if (resizeDebounceRef.current != null) {
        window.clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
      commitStableViewportWidth(viewportWidth);
      return;
    }

    if (!resizingRef.current) {
      if (resizeDebounceRef.current != null) {
        window.clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
      commitStableViewportWidth(viewportWidth);
      return;
    }

    if (resizeDebounceRef.current != null) {
      window.clearTimeout(resizeDebounceRef.current);
    }
    resizeDebounceRef.current = window.setTimeout(() => {
      resizeDebounceRef.current = null;
      commitStableViewportWidth(viewportSizeRef.current.width);
    }, AUTO_GRID_RESIZE_DEBOUNCE_MS);

    return () => {
      if (resizeDebounceRef.current != null) {
        window.clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
    };
  }, [gridSize, viewportSize.width]);

  useEffect(() => {
    const nextWidth = viewportSizeRef.current.width;
    if (gridSize === "auto" && nextWidth <= 0) return;
    commitStableViewportWidth(nextWidth);
  }, [gridSize, instantResizeKey, viewKey]);

  useEffect(() => {
    if (!onAutoViewportWidthChange) return;
    if (gridSize !== "auto") return;
    if (stableViewportWidth <= 0) return;
    onAutoViewportWidthChange(stableViewportWidth);
  }, [gridSize, onAutoViewportWidthChange, stableViewportWidth]);

  useEffect(() => {
    return () => {
      if (resizeDebounceRef.current != null) {
        window.clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
    };
  }, []);

  return {
    viewportRef,
    viewportWidth: viewportSize.width,
    viewportHeight: viewportSize.height,
    stableViewportWidth,
    isResizing,
  };
};
