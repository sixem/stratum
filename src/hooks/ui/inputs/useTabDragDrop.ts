// Pointer-driven tab reordering with a simple drop indicator.
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

type UseTabDragDropOptions = {
  onReorder: (fromId: string, toIndex: number) => void;
  containerRef: RefObject<HTMLElement | null>;
};

type DragState = {
  active: boolean;
  dragging: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  tabId: string | null;
};

const DRAG_THRESHOLD = 4;
const SUPPRESS_TIMEOUT_MS = 400;

export const useTabDragDrop = ({ onReorder, containerRef }: UseTabDragDropOptions) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dropIndicatorX, setDropIndicatorX] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const dragRef = useRef<DragState>({
    active: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    tabId: null,
  });
  const onReorderRef = useRef(onReorder);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  const computeDropIndicatorX = (nextIndex: number | null) => {
    if (nextIndex == null) return null;
    const container = containerRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>(".tab[data-tab-id]"),
    );
    if (tabs.length === 0) return 0;
    if (nextIndex <= 0) {
      const firstRect = tabs[0]?.getBoundingClientRect();
      return firstRect ? firstRect.left - containerRect.left : 0;
    }
    if (nextIndex >= tabs.length) {
      const lastRect = tabs[tabs.length - 1]?.getBoundingClientRect();
      return lastRect ? lastRect.right - containerRect.left : 0;
    }
    const targetRect = tabs[nextIndex]?.getBoundingClientRect();
    return targetRect ? targetRect.left - containerRect.left : null;
  };

  const setDropIndexValue = (nextIndex: number | null) => {
    dropIndexRef.current = nextIndex;
    setDropIndex(nextIndex);
    setDropIndicatorX(computeDropIndicatorX(nextIndex));
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
      tabId: null,
    };
  };

  const stopWindowTracking = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);
  };

  const computeDropIndex = (clientX: number) => {
    const container = containerRef.current;
    if (!container) return null;
    // Snapshot the tab layout so we can place the indicator between them.
    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>(".tab[data-tab-id]"),
    );
    if (tabs.length === 0) return 0;
    for (let index = 0; index < tabs.length; index += 1) {
      const rect = tabs[index]?.getBoundingClientRect();
      if (!rect) continue;
      if (clientX < rect.left + rect.width / 2) {
        return index;
      }
    }
    return tabs.length;
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
      setDraggingId(drag.tabId);
      armSuppress();
    }
    const nextIndex = computeDropIndex(event.clientX);
    if (nextIndex == null) return;
    setDropIndexValue(nextIndex);
  };

  const handlePointerUp = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const wasDragging = drag.dragging;
    const tabId = drag.tabId;
    const nextIndex = dropIndexRef.current;
    stopWindowTracking();
    resetDrag();
    if (wasDragging && tabId && nextIndex != null) {
      onReorderRef.current(tabId, nextIndex);
    }
    setDraggingId(null);
    setDropIndexValue(null);
  };

  const handlePointerCancel = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    stopWindowTracking();
    resetDrag();
    setDraggingId(null);
    setDropIndexValue(null);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (event.button !== 0) return;
    dragRef.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      tabId: id,
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
    draggingId,
    dropIndex,
    dropIndicatorX,
    handlePointerDown,
    handleSuppressClick,
  };
};
