// Handles preview-stage interaction: zoom, pan, pointer drag, and keyboard shortcuts.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { FileEntry } from "@/types";
import { isEditableElement } from "@/lib";
import { useModalFocusTrap } from "@/hooks/ui/app/useModalFocusTrap";

type DragState = {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type UseQuickPreviewInputOptions = {
  open: boolean;
  playable: boolean;
  stripOpen: boolean;
  previewItems: FileEntry[];
  activeIndex: number;
  activePath: string;
  onSelectPreview: (path: string) => void;
  smartTabJump: boolean;
  smartTabBlocked: boolean;
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const ZOOM_SPEED = 0.0014;
const TAB_DOUBLE_TAP_MS = 280;
const SHORT_SEEK_SECONDS = 5;
const WHEEL_TRANSFORM_SETTLE_MS = 140;

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export const useQuickPreviewInput = ({
  open,
  playable,
  stripOpen,
  previewItems,
  activeIndex,
  activePath,
  onSelectPreview,
  smartTabJump,
  smartTabBlocked,
}: UseQuickPreviewInputOptions) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const dragRef = useRef<DragState>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const frameRef = useRef<number | null>(null);
  const wheelTransformTimerRef = useRef<number | null>(null);
  const fitSizeRef = useRef<{ width: number; height: number } | null>(null);
  const minZoomRef = useRef(MIN_ZOOM);
  const offsetRef = useRef({ x: 0, y: 0 });
  const lastTabTapRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [transforming, setTransforming] = useState(false);
  useModalFocusTrap({ open, containerRef, initialFocusRef: containerRef });

  const scheduleOffset = (next: { x: number; y: number }) => {
    offsetRef.current = next;
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setOffset(offsetRef.current);
    });
  };

  const resetViewport = useCallback(() => {
    fitSizeRef.current = null;
    minZoomRef.current = MIN_ZOOM;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    offsetRef.current = { x: 0, y: 0 };
  }, []);

  // Fit media inside the stage while preserving aspect ratio.
  const fitMediaToViewport = useCallback((width: number, height: number) => {
    const container = stageRef.current ?? containerRef.current;
    if (!container) return;
    if (width <= 0 || height <= 0) return;
    const bounds = container.getBoundingClientRect();
    fitSizeRef.current = { width, height };
    if (!bounds.width || !bounds.height) return;
    const fitZoom = Math.min(bounds.width / width, bounds.height / height, 1);
    minZoomRef.current = Math.min(fitZoom, MIN_ZOOM);
    setZoom(fitZoom);
    setOffset({ x: 0, y: 0 });
    offsetRef.current = { x: 0, y: 0 };
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage) return;
    const observer = new ResizeObserver(() => {
      const size = fitSizeRef.current;
      if (size) fitMediaToViewport(size.width, size.height);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fitMediaToViewport, open]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (wheelTransformTimerRef.current != null) {
        window.clearTimeout(wheelTransformTimerRef.current);
      }
    };
  }, []);

  const scheduleWheelTransformSettle = () => {
    if (wheelTransformTimerRef.current != null) {
      window.clearTimeout(wheelTransformTimerRef.current);
    }
    wheelTransformTimerRef.current = window.setTimeout(() => {
      wheelTransformTimerRef.current = null;
      if (!dragRef.current.active) {
        setTransforming(false);
      }
    }, WHEEL_TRANSFORM_SETTLE_MS);
  };

  // Keep timeline shortcuts intentionally minimal: Shift+Arrow seeks by +/-5s.
  useEffect(() => {
    if (!open || !playable) return;
    const handleSeekKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.repeat) return;
      if (!event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (!document.hasFocus()) return;

      event.preventDefault();
      event.stopPropagation();

      const media = mediaRef.current;
      if (!media) return;
      const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
      if (duration <= 0) return;

      const delta = event.key === "ArrowLeft" ? -SHORT_SEEK_SECONDS : SHORT_SEEK_SECONDS;
      const target = clamp(media.currentTime + delta, 0, duration);
      if (typeof media.fastSeek === "function") {
        try {
          media.fastSeek(target);
        } catch {
          media.currentTime = target;
        }
      } else {
        media.currentTime = target;
      }
    };

    window.addEventListener("keydown", handleSeekKey);
    return () => window.removeEventListener("keydown", handleSeekKey);
  }, [open, playable]);

  // Non-shift arrows navigate adjacent media items in the right strip.
  useEffect(() => {
    if (!open) return;
    const handleStripArrowNav = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.shiftKey) return;
      if (event.isComposing) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (!document.hasFocus()) return;

      if (activeIndex < 0) return;

      const delta = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = activeIndex + delta;
      if (nextIndex < 0 || nextIndex >= previewItems.length) return;
      const nextPath = previewItems[nextIndex]?.path;
      if (!nextPath || nextPath === activePath) return;

      event.preventDefault();
      event.stopPropagation();
      onSelectPreview(nextPath);
    };

    window.addEventListener("keydown", handleStripArrowNav);
    return () => window.removeEventListener("keydown", handleStripArrowNav);
  }, [activeIndex, activePath, onSelectPreview, open, previewItems]);

  // Keep Space available to focused controls and use it for playback on the stage.
  useEffect(() => {
    if (!open || !playable) return;
    const handleSpace = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.repeat) return;

      const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
      if (!isSpace) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (active?.closest("button, [role='slider']")) return;
      if (!document.hasFocus()) return;

      event.preventDefault();
      event.stopPropagation();

      const media = mediaRef.current;
      if (!media) return;
      if (media.paused) {
        void media.play().catch(() => {});
      } else {
        media.pause();
      }
    };

    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [open, playable]);

  // Smart Tab jump also works in preview mode to jump the right-hand strip.
  useEffect(() => {
    if (!open || !stripOpen || !smartTabJump) return;
    lastTabTapRef.current = 0;
    const handleTabJump = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Tab") return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.isComposing || event.repeat) return;
      if (smartTabBlocked) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (!document.hasFocus()) return;
      const strip = stripRef.current;
      if (!strip) return;
      const maxScrollTop = strip.scrollHeight - strip.clientHeight;
      if (maxScrollTop <= 0) return;

      event.preventDefault();
      event.stopPropagation();

      const now = performance.now();
      const elapsed = now - lastTabTapRef.current;
      lastTabTapRef.current = now;
      if (elapsed > TAB_DOUBLE_TAP_MS) return;

      const ratio = strip.scrollTop / maxScrollTop;
      strip.scrollTop = ratio < 0.5 ? maxScrollTop : 0;
    };

    window.addEventListener("keydown", handleTabJump);
    return () => window.removeEventListener("keydown", handleTabJump);
  }, [open, smartTabBlocked, smartTabJump, stripOpen]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!open) return;
    event.preventDefault();
    fitSizeRef.current = null;
    setTransforming(true);
    scheduleWheelTransformSettle();
    const factor = Math.exp(-event.deltaY * ZOOM_SPEED);
    setZoom((value) => clamp(value * factor, minZoomRef.current, MAX_ZOOM));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!open) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".quick-preview-controls")) return;
    if (target?.closest(".quick-preview-error")) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
    };
    setTransforming(true);
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (dx !== 0 || dy !== 0) fitSizeRef.current = null;
    scheduleOffset({ x: drag.originX + dx, y: drag.originY + dy });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    dragRef.current = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0,
    };
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (wheelTransformTimerRef.current == null) {
      setTransforming(false);
    }
    setDragging(false);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    dragRef.current.active = false;
    dragRef.current.pointerId = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (wheelTransformTimerRef.current == null) {
      setTransforming(false);
    }
    setDragging(false);
  };

  return {
    containerRef,
    stageRef,
    stripRef,
    mediaRef,
    zoom,
    offset,
    dragging,
    transforming,
    resetViewport,
    fitMediaToViewport,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  };
};
