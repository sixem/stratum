import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { getDropTargetHit } from "@/lib";
import type { DropTarget } from "@/lib";

type UseEntryDragOutOptions = {
  selected: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onStartDrag: (paths: string[]) => void;
  onInternalDrop?: (paths: string[], target: DropTarget | null) => void;
  onInternalHover?: (target: DropTarget | null) => void;
  itemSelector: string;
  enabled?: boolean;
};

type DragState = {
  active: boolean;
  dragging: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  path: string | null;
  paths: string[] | null;
  target: DropTarget | null;
};

const DRAG_THRESHOLD = 4;
const SUPPRESS_TIMEOUT_MS = 400;

export const useEntryDragOut = (
  ref: RefObject<HTMLElement | null>,
  {
    selected,
    onSetSelection,
    onStartDrag,
    onInternalDrop,
    onInternalHover,
    itemSelector,
    enabled = true,
  }: UseEntryDragOutOptions,
) => {
  const selectedRef = useRef(selected);
  const onSetSelectionRef = useRef(onSetSelection);
  const onStartDragRef = useRef(onStartDrag);
  const onInternalDropRef = useRef(onInternalDrop);
  const onInternalHoverRef = useRef(onInternalHover);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const lastHoverKeyRef = useRef<string | null>(null);
  const dragCursorActiveRef = useRef(false);
  const dragRef = useRef<DragState>({
    active: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    path: null,
    paths: null,
    target: null,
  });

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    onSetSelectionRef.current = onSetSelection;
  }, [onSetSelection]);

  useEffect(() => {
    onStartDragRef.current = onStartDrag;
  }, [onStartDrag]);

  useEffect(() => {
    onInternalDropRef.current = onInternalDrop;
  }, [onInternalDrop]);

  useEffect(() => {
    onInternalHoverRef.current = onInternalHover;
  }, [onInternalHover]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    const setInternalDragCursor = (active: boolean) => {
      if (dragCursorActiveRef.current === active) return;
      dragCursorActiveRef.current = active;
      const body = document.body;
      if (!body) return;
      if (active) {
        body.setAttribute("data-internal-drag", "true");
      } else {
        body.removeAttribute("data-internal-drag");
      }
    };

    const resetDrag = () => {
      setInternalDragCursor(false);
      dragRef.current = {
        active: false,
        dragging: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        path: null,
        paths: null,
        target: null,
      };
    };

    const clearHoverState = () => {
      if (lastHoverKeyRef.current == null) return;
      lastHoverKeyRef.current = null;
      onInternalHoverRef.current?.(null);
    };

    const updateHoverState = (target: DropTarget | null) => {
      const nextKey = target
        ? `${target.kind}:${target.kind === "tab" ? target.tabId ?? target.path : target.path}`
        : null;
      if (lastHoverKeyRef.current === nextKey) return;
      lastHoverKeyRef.current = nextKey;
      onInternalHoverRef.current?.(target);
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

    const stopWindowTracking = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };

    const releasePointerCapture = (pointerId: number | null) => {
      if (pointerId == null) return;
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    };

    const isOutsideWindow = (event: PointerEvent) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      return (
        event.clientX < 0 ||
        event.clientY < 0 ||
        event.clientX > width ||
        event.clientY > height
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;
      const dx = Math.abs(event.clientX - drag.startX);
      const dy = Math.abs(event.clientY - drag.startY);
      if (!drag.dragging && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
        return;
      }
      const path = drag.path;
      if (!path) {
        resetDrag();
        stopWindowTracking();
        return;
      }

      if (!drag.dragging) {
        drag.dragging = true;
        armSuppress();
        setInternalDragCursor(true);
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          // Ignore pointer capture failures.
        }
        const selection = selectedRef.current;
        const dragPaths = selection.has(path) ? Array.from(selection) : [path];
        if (!selection.has(path)) {
          onSetSelectionRef.current(dragPaths, path);
        }
        drag.paths = dragPaths;
      }

      if (drag.paths && isOutsideWindow(event)) {
        const dragPaths = drag.paths;
        setInternalDragCursor(false);
        clearHoverState();
        releasePointerCapture(event.pointerId);
        resetDrag();
        stopWindowTracking();
        onStartDragRef.current(dragPaths);
        return;
      }

      const hit = getDropTargetHit(event.clientX, event.clientY);
      drag.target = hit.target;
      updateHoverState(hit.target);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;
      const dragPaths = drag.paths;
      const dragTarget = drag.target;
      const wasDragging = drag.dragging;
      clearHoverState();
      setInternalDragCursor(false);
      releasePointerCapture(event.pointerId);
      resetDrag();
      stopWindowTracking();
      if (wasDragging && dragPaths) {
        onInternalDropRef.current?.(dragPaths, dragTarget);
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;
      clearHoverState();
      setInternalDragCursor(false);
      releasePointerCapture(event.pointerId);
      resetDrag();
      stopWindowTracking();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      // Let inline rename selection happen without kicking off a drag.
      if (target?.closest(".rename-input")) return;
      const item = target?.closest<HTMLElement>(itemSelector);
      if (!item) return;
      const path = item.dataset.path;
      if (!path) return;

      dragRef.current = {
        active: true,
        dragging: false,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        path,
        paths: null,
        target: null,
      };
      clearHoverState();
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
    };

    const handleClickCapture = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest(itemSelector)) return;
      event.preventDefault();
      event.stopPropagation();
      clearSuppress();
    };

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("click", handleClickCapture, true);

    return () => {
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("click", handleClickCapture, true);
      stopWindowTracking();
      clearSuppress();
      clearHoverState();
      setInternalDragCursor(false);
      releasePointerCapture(dragRef.current.pointerId);
      resetDrag();
    };
  }, [enabled, itemSelector, ref]);
};
