// Vertical filmstrip used to jump between previewable items.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { FILE_TOOLTIP_DELAY_MS } from "@/constants";
import type { EntryMeta, FileEntry, ThumbnailRequest } from "@/types";
import { formatBytes, formatDate, getFileKind, splitNameExtension } from "@/lib";
import { useEntryMetaRequest, useThumbnailRequest, useVirtualRange } from "@/hooks";
import { TooltipWrapper } from "@/components/overlay/Tooltip";

type QuickPreviewStripProps = {
  open: boolean;
  items: FileEntry[];
  activePath: string | null;
  entryMeta: Map<string, EntryMeta>;
  thumbnails: Map<string, string>;
  thumbnailsEnabled: boolean;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  onRequestThumbs: (requests: ThumbnailRequest[]) => void;
  thumbResetKey?: string;
  loading: boolean;
  onSelect: (path: string) => void;
  stripRef?: MutableRefObject<HTMLDivElement | null>;
};

const STRIP_ITEM_HEIGHT = 72;
const IDLE_FADE_DELAY_MS = 1400;
const DRAG_THRESHOLD_PX = 4;
const STRIP_SCROLL_RETRY_FRAMES = 12;

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export const QuickPreviewStrip = ({
  open,
  items,
  activePath,
  entryMeta,
  thumbnails,
  thumbnailsEnabled,
  onRequestMeta,
  onRequestThumbs,
  thumbResetKey,
  loading,
  onSelect,
  stripRef: externalStripRef,
}: QuickPreviewStripProps) => {
  const internalStripRef = useRef<HTMLDivElement | null>(null);
  const stripRef = externalStripRef ?? internalStripRef;
  const idleTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const dragRef = useRef({
    active: false,
    pointerId: null as number | null,
    startY: 0,
    startScroll: 0,
    moved: false,
    captured: false,
  });
  const [stripActive, setStripActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scrollRetryRef = useRef<number | null>(null);
  const scrollRetryCountRef = useRef(0);

  const virtual = useVirtualRange(stripRef, items.length, STRIP_ITEM_HEIGHT, 6);
  const visibleItems = useMemo(
    () => items.slice(virtual.startIndex, virtual.endIndex),
    [items, virtual.endIndex, virtual.startIndex],
  );
  const activeIndex = useMemo(
    () => (activePath ? items.findIndex((entry) => entry.path === activePath) : -1),
    [activePath, items],
  );

  const markStripActive = useCallback(() => {
    if (!open) return;
    setStripActive(true);
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      setStripActive(false);
    }, IDLE_FADE_DELAY_MS);
  }, [open]);

  useEffect(() => {
    if (open) return;
    setStripActive(false);
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    markStripActive();
  }, [activePath, markStripActive, open]);

  const clearScrollRetry = useCallback(() => {
    scrollRetryCountRef.current = 0;
    if (scrollRetryRef.current == null) return;
    window.cancelAnimationFrame(scrollRetryRef.current);
    scrollRetryRef.current = null;
  }, []);

  const ensureActiveInView = useCallback(() => {
    const container = stripRef.current;
    if (!open || !container || activeIndex < 0 || dragRef.current.active || dragging) {
      return false;
    }

    const viewHeight = container.clientHeight;
    const totalHeight = items.length * STRIP_ITEM_HEIGHT;
    if (viewHeight <= 0) {
      // The strip can report 0 height on the first paint when the overlay opens.
      // Retry on the next frame so we can measure and position reliably.
      return false;
    }
    if (totalHeight <= viewHeight) return true;

    const targetTop = activeIndex * STRIP_ITEM_HEIGHT;
    const targetBottom = targetTop + STRIP_ITEM_HEIGHT;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + viewHeight;
    const fullyVisible = targetTop >= viewTop && targetBottom <= viewBottom;
    if (fullyVisible) return true;

    const centerOffset = (viewHeight - STRIP_ITEM_HEIGHT) / 2;
    const nextTop = clamp(targetTop - centerOffset, 0, totalHeight - viewHeight);
    container.scrollTop = nextTop;
    return true;
  }, [activeIndex, dragging, items.length, open, stripRef]);

  useLayoutEffect(() => {
    clearScrollRetry();

    const tryScroll = () => {
      if (ensureActiveInView()) return;
      if (scrollRetryCountRef.current >= STRIP_SCROLL_RETRY_FRAMES) return;
      scrollRetryCountRef.current += 1;
      scrollRetryRef.current = window.requestAnimationFrame(() => {
        scrollRetryRef.current = null;
        tryScroll();
      });
    };

    tryScroll();
  }, [activeIndex, clearScrollRetry, ensureActiveInView, items.length, open]);

  useEffect(() => {
    return () => {
      clearScrollRetry();
      if (idleTimerRef.current != null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, [clearScrollRetry]);

  const { metaPaths, thumbRequests } = useMemo(() => {
    if (visibleItems.length === 0) {
      return { metaPaths: [] as string[], thumbRequests: [] as ThumbnailRequest[] };
    }
    const nextMeta: string[] = [];
    const nextThumbs: ThumbnailRequest[] = [];
    visibleItems.forEach((entry) => {
      const path = entry.path;
      nextMeta.push(path);
      const meta = entryMeta.get(path);
      nextThumbs.push({
        path,
        size: meta?.size ?? null,
        modified: meta?.modified ?? null,
      });
    });
    return { metaPaths: nextMeta, thumbRequests: nextThumbs };
  }, [entryMeta, visibleItems]);

  const requestLoading = loading || !open;
  useEntryMetaRequest(requestLoading, metaPaths, onRequestMeta);
  const canRequestThumbs = thumbnailsEnabled && !loading && open;
  useThumbnailRequest(requestLoading, canRequestThumbs, thumbRequests, onRequestThumbs, thumbResetKey);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    markStripActive();
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startY: event.clientY,
      startScroll: event.currentTarget.scrollTop,
      moved: false,
      captured: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.captured = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    markStripActive();
    event.preventDefault();
    event.currentTarget.scrollTop = drag.startScroll - delta;
  };

  const releaseDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    dragRef.current.active = false;
    dragRef.current.pointerId = null;
    if (drag.captured && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragRef.current.moved = false;
    setDragging(false);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    releaseDrag(event);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    markStripActive();
    event.stopPropagation();
  };

  const handleScroll = () => {
    markStripActive();
  };

  const handleSelect = (path: string) => {
    if (suppressClickRef.current) return;
    onSelect(path);
  };

  if (!open || items.length === 0) {
    return null;
  }

  return (
    <div
      className="quick-preview-strip"
      data-idle={stripActive ? "false" : "true"}
      data-dragging={dragging ? "true" : "false"}
      ref={stripRef}
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => {
        markStripActive();
        if (!dragRef.current.active) return;
        handlePointerMove(event);
      }}
      onPointerUp={releaseDrag}
      onPointerCancel={handlePointerCancel}
      onWheel={handleWheel}
      onScroll={handleScroll}
    >
      <div
        className="quick-preview-strip-spacer"
        style={{ height: `${virtual.totalHeight}px` }}
      />
      <div
        className="quick-preview-strip-list"
        style={{ transform: `translate3d(0, ${virtual.offsetTop}px, 0)` }}
      >
        {visibleItems.map((entry, index) => {
          const absoluteIndex = virtual.startIndex + index;
          const isActive = entry.path === activePath;
          const distance = activeIndex >= 0 ? Math.abs(absoluteIndex - activeIndex) : 0;
          const opacity =
            isActive || activeIndex < 0 ? 1 : clamp(1 - distance * 0.08, 0.25, 0.9);
          const thumbUrl = thumbnails.get(entry.path);
          const extension = splitNameExtension(entry.name).extension;
          const kind = getFileKind(entry.name);
          const fallbackLabel =
            extension ? extension.toUpperCase() : kind === "video" ? "VID" : "IMG";
          const meta = entryMeta.get(entry.path);
          const sizeLabel = formatBytes(meta?.size ?? null);
          const modifiedLabel = formatDate(meta?.modified ?? null);
          const tooltipText = `${entry.name}\nSize: (${sizeLabel})\nModified: ${modifiedLabel}`;
          return (
            <TooltipWrapper
              key={entry.path}
              text={tooltipText}
              disabled={dragging}
              delayMs={FILE_TOOLTIP_DELAY_MS}
            >
              <button
                type="button"
                className="quick-preview-strip-item"
                data-active={isActive ? "true" : "false"}
                aria-current={isActive ? "true" : undefined}
                aria-label={entry.name}
                onClick={() => handleSelect(entry.path)}
                style={{ opacity }}
              >
                {thumbUrl ? (
                  <img
                    className="quick-preview-strip-thumb"
                    src={thumbUrl}
                    alt={entry.name}
                    draggable={false}
                  />
                ) : (
                  <div className="quick-preview-strip-fallback">{fallbackLabel}</div>
                )}
              </button>
            </TooltipWrapper>
          );
        })}
      </div>
    </div>
  );
};
