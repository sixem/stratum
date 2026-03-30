// Pointer-driven drag reorder state for pinned sidebar places.
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

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
};

type DropTarget = {
  path: string;
  position: PinnedDropPosition;
} | null;

const DRAG_THRESHOLD = 4;
const SUPPRESS_TIMEOUT_MS = 400;

export const usePinnedPlaceDragDrop = ({
  onReorder,
  containerRef,
}: UsePinnedPlaceDragDropOptions) => {
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const dropTargetRef = useRef<DropTarget>(null);
  const dragRef = useRef<DragState>({
    active: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    path: null,
  });
  const onReorderRef = useRef(onReorder);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  const setDropTargetValue = (nextTarget: DropTarget) => {
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
    };
  };

  const stopWindowTracking = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);
  };

  const computeDropTarget = (clientY: number): DropTarget => {
    const container = containerRef.current;
    if (!container) return null;
    const places = Array.from(
      container.querySelectorAll<HTMLElement>(".place[data-place-kind='pinned']"),
    );
    if (places.length === 0) return null;

    for (const place of places) {
      const rect = place.getBoundingClientRect();
      const path = place.dataset.path;
      if (!path) continue;
      const midpoint = rect.top + rect.height / 2;
      if (clientY < midpoint) {
        return { path, position: "before" };
      }
    }

    const lastPlace = places[places.length - 1];
    const lastPath = lastPlace?.dataset.path;
    return lastPath ? { path: lastPath, position: "after" } : null;
  };

  const handlePointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const dx = Math.abs(event.clientX - drag.startX);
    const dy = Math.abs(event.clientY - drag.startY);
    if (!drag.dragging && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
      return;
    }
    if (!drag.dragging) {
      drag.dragging = true;
      setDraggingPath(drag.path);
      armSuppress();
    }
    const nextTarget = computeDropTarget(event.clientY);
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
    const nextTarget = dropTargetRef.current;
    stopWindowTracking();
    resetDrag();
    if (wasDragging && sourcePath && nextTarget) {
      onReorderRef.current(sourcePath, nextTarget.path, nextTarget.position);
    }
    setDraggingPath(null);
    setDropTargetValue(null);
  };

  const handlePointerCancel = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    stopWindowTracking();
    resetDrag();
    setDraggingPath(null);
    setDropTargetValue(null);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, path: string) => {
    if (event.button !== 0) return;
    dragRef.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      path,
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
  };

  const handleSuppressClick = (event: ReactMouseEvent) => {
    if (!suppressClickRef.current) return;
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
