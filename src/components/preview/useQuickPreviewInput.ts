// Handles preview-stage interaction: zoom, pan, pointer drag, and keyboard shortcuts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { FileEntry } from "@/types";
import { getFileKind, isEditableElement, normalizePath } from "@/lib";

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
  isVideo: boolean;
  items: FileEntry[];
  activePath: string;
  onSelectPreview: (path: string) => void;
  smartTabJump: boolean;
  smartTabBlocked: boolean;
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const ZOOM_SPEED = 0.0014;
const TAB_DOUBLE_TAP_MS = 280;
const VIDEO_SHORT_SEEK_SECONDS = 5;
const WHEEL_TRANSFORM_SETTLE_MS = 140;

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export const useQuickPreviewInput = ({
  open,
  isVideo,
  items,
  activePath,
  onSelectPreview,
  smartTabJump,
  smartTabBlocked,
}: UseQuickPreviewInputOptions) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
  const offsetRef = useRef({ x: 0, y: 0 });
  const lastTabTapRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [transforming, setTransforming] = useState(false);
  const previewItems = useMemo(
    () =>
      items.filter((entry) => {
        if (entry.isDir) return false;
        const kind = getFileKind(entry.name);
        return kind === "image" || kind === "video";
      }),
    [items],
  );

  const scheduleOffset = (next: { x: number; y: number }) => {
    offsetRef.current = next;
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setOffset(offsetRef.current);
    });
  };

  const resetViewport = useCallback(() => {
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
    const fitZoom = Math.min(bounds.width / width, bounds.height / height, 1);
    const nextZoom = clamp(fitZoom, MIN_ZOOM, MAX_ZOOM);
    setZoom(nextZoom);
    setOffset({ x: 0, y: 0 });
    offsetRef.current = { x: 0, y: 0 };
  }, []);

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
    if (!open || !isVideo) return;
    const handleVideoSeekKey = (event: KeyboardEvent) => {
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

      const video = videoRef.current;
      if (!video) return;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (duration <= 0) return;

      const delta = event.key === "ArrowLeft" ? -VIDEO_SHORT_SEEK_SECONDS : VIDEO_SHORT_SEEK_SECONDS;
      const target = clamp(video.currentTime + delta, 0, duration);
      if (typeof video.fastSeek === "function") {
        try {
          video.fastSeek(target);
        } catch {
          video.currentTime = target;
        }
      } else {
        video.currentTime = target;
      }
    };

    window.addEventListener("keydown", handleVideoSeekKey);
    return () => window.removeEventListener("keydown", handleVideoSeekKey);
  }, [isVideo, open]);

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

      if (!activePath || previewItems.length === 0) return;
      const activePathKey = normalizePath(activePath);
      const activeIndex = previewItems.findIndex(
        (entry) =>
          entry.path === activePath ||
          (activePathKey !== "" && normalizePath(entry.path) === activePathKey),
      );
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
  }, [activePath, onSelectPreview, open, previewItems]);

  // Space is reserved for video playback in preview mode.
  useEffect(() => {
    if (!open || !isVideo) return;
    const handleSpace = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.repeat) return;

      const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
      if (!isSpace) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (!document.hasFocus()) return;

      event.preventDefault();
      event.stopPropagation();

      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
        void video.play().catch(() => {});
      } else {
        video.pause();
      }
    };

    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [isVideo, open]);

  // Smart Tab jump also works in preview mode to jump the right-hand strip.
  useEffect(() => {
    if (!open || !smartTabJump) return;
    const handleTabJump = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Tab") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.repeat) return;
      if (smartTabBlocked) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (!document.hasFocus()) return;

      event.preventDefault();
      event.stopPropagation();

      const now = performance.now();
      const elapsed = now - lastTabTapRef.current;
      lastTabTapRef.current = now;
      if (elapsed > TAB_DOUBLE_TAP_MS) return;

      const strip = stripRef.current;
      if (!strip) return;
      const maxScrollTop = Math.max(0, strip.scrollHeight - strip.clientHeight);
      if (maxScrollTop <= 0) return;
      const ratio = strip.scrollTop / maxScrollTop;
      strip.scrollTop = ratio < 0.5 ? maxScrollTop : 0;
    };

    window.addEventListener("keydown", handleTabJump);
    return () => window.removeEventListener("keydown", handleTabJump);
  }, [open, smartTabBlocked, smartTabJump]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!open) return;
    event.preventDefault();
    setTransforming(true);
    scheduleWheelTransformSettle();
    const factor = Math.exp(-event.deltaY * ZOOM_SPEED);
    setZoom((value) => clamp(value * factor, MIN_ZOOM, MAX_ZOOM));
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
    videoRef,
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
