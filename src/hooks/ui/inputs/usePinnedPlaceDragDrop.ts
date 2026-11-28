// Pointer-driven drag reorder state for pinned sidebar places.
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { openRemotePlace } from "@/modules/remotePlaces";
import { DRAG_THRESHOLD_PX } from "@/constants";
import { createTabLocationHover, getTabLocationDropTarget, openDroppedLocation } from "@/lib/tabLocationDrop";

type PinnedDropPosition = "before" | "after";

type UsePinnedPlaceDragDropOptions = {
  onReorder: (fromPath: string, toPath: string, position: PinnedDropPosition) => void;
  containerRef: RefObject<HTMLElement | null>;
};

type DragState = {
  active: boolean;
  dragging: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  path: string | null;
  source: HTMLButtonElement | null;
};

type DropTarget = {
  path: string;
  position: PinnedDropPosition;
} | null;

const SUPPRESS_TIMEOUT_MS = 400;

export const usePinnedPlaceDragDrop = ({
  onReorder,
  containerRef,
}: UsePinnedPlaceDragDropOptions) => {
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [highlightTabs] = useState(createTabLocationHover);
  const dropTargetRef = useRef<DropTarget>(null);
  const dragRef = useRef<DragState>({
    active: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    path: null,
    source: null,
  });
  const onReorderRef = useRef(onReorder);
  const windowTrackingRef = useRef<AbortController | null>(null);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  const setDropTargetValue = (nextTarget: DropTarget) => {
    const current = dropTargetRef.current;
    if (current?.path === nextTarget?.path && current?.position === nextTarget?.position) return;
    dropTargetRef.current = nextTarget;
    setDropTarget(nextTarget);
  };

  const clearSuppress = () => {
    suppressClickRef.current = false;
    if (suppressTimerRef.current != null) {
      window.clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  };

  const armSuppress = () => {
    suppressClickRef.current = true;
    if (suppressTimerRef.current != null) {
      window.clearTimeout(suppressTimerRef.current);
    }
    suppressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressTimerRef.current = null;
    }, SUPPRESS_TIMEOUT_MS);
  };

  const resetDrag = () => {
    dragRef.current = {
      active: false,
      dragging: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      path: null,
      source: null,
    };
  };

  const stopWindowTracking = () => {
    windowTrackingRef.current?.abort();
    windowTrackingRef.current = null;
    highlightTabs(null);
    const { source, pointerId } = dragRef.current;
    if (pointerId != null && source?.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
  };

  const computeDropTarget = (point: PointerEvent): DropTarget => {
    const container = containerRef.current;
    if (!container?.contains(document.elementFromPoint(point.clientX, point.clientY))) return null;
    const places = Array.from(
      container.querySelectorAll<HTMLElement>(".place[data-place-kind='pinned']"),
    );
    if (places.length === 0) return null;

    for (const place of places) {
      const rect = place.getBoundingClientRect();
      const path = place.dataset.placeKey;
      if (!path) continue;
      const midpoint = rect.top + rect.height / 2;
      if (point.clientY < midpoint) {
        return { path, position: "before" };
      }
    }

    const lastPlace = places[places.length - 1];
    const lastPath = lastPlace?.dataset.placeKey;
    return lastPath ? { path: lastPath, position: "after" } : null;
  };

  const handlePointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    if (!(event.buttons & 1) || !drag.source?.isConnected) return handlePointerCancel(event);
    const dx = Math.abs(event.clientX - drag.startX);
    const dy = Math.abs(event.clientY - drag.startY);
    if (!drag.dragging && dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) {
      return;
    }
    if (!drag.dragging) {
      drag.dragging = true;
      drag.source?.setPointerCapture(event.pointerId);
      setDraggingPath(drag.path);
      armSuppress();
    }
    const tabStrip = getTabLocationDropTarget(event.clientX, event.clientY);
    highlightTabs(tabStrip);
    const nextTarget = tabStrip ? null : computeDropTarget(event);
    if (!nextTarget || nextTarget.path === drag.path) {
      setDropTargetValue(null);
      return;
    }
    setDropTargetValue(nextTarget);
  };

  const handlePointerUp = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const wasDragging = drag.dragging;
    const sourcePath = drag.path;
    const tabStrip = wasDragging ? getTabLocationDropTarget(event.clientX, event.clientY) : null;
    const nextTarget = wasDragging && !tabStrip ? computeDropTarget(event) : null;
    if (wasDragging) armSuppress();
    clearDrag();
    if (!sourcePath) return;
    if (tabStrip) {
      const data = drag.source?.dataset;
      if (data?.placeHost && data.remotePlacePath) {
        openRemotePlace({ hostId: data.placeHost, path: data.remotePlacePath }, tabStrip.dataset.tabPane === "bottom" ? "bottom" : "main", true);
      } else if (data?.path) openDroppedLocation(tabStrip, data.path);
    } else if (nextTarget && nextTarget.path !== sourcePath) {
      onReorderRef.current(sourcePath, nextTarget.path, nextTarget.position);
    }
  };

  const clearDrag = () => {
    stopWindowTracking();
    resetDrag();
    setDraggingPath(null);
    setDropTargetValue(null);
  };

  const handlePointerCancel = (event: PointerEvent) => {
    if (dragRef.current.pointerId === event.pointerId) clearDrag();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, path: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    stopWindowTracking();
    clearSuppress();
    dragRef.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      path,
      source: event.currentTarget,
    };
    const tracking = new AbortController();
    windowTrackingRef.current = tracking;
    const { signal } = tracking;
    window.addEventListener("pointermove", handlePointerMove, { signal });
    window.addEventListener("pointerup", handlePointerUp, { signal });
    window.addEventListener("pointercancel", handlePointerCancel, { signal });
    window.addEventListener("keydown", (key) => {
      if (key.key === "Escape" && dragRef.current.dragging) {
        key.preventDefault();
        key.stopPropagation();
        armSuppress();
        clearDrag();
      }
    }, { signal, capture: true });
    window.addEventListener("blur", clearDrag, { signal });
  };

  const handleSuppressClick = (event: ReactMouseEvent) => {
    if (!suppressClickRef.current || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
    clearSuppress();
  };

  useEffect(() => {
    return () => {
      stopWindowTracking();
      clearSuppress();
    };
  }, []);

  return {
    draggingPath,
    dropTarget,
    handlePointerDown,
    handleSuppressClick,
  };
};
