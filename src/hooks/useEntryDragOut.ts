import { useEffect, useRef } from "react";
import type { RefObject } from "react";

type UseEntryDragOutOptions = {
  selected: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onStartDrag: (paths: string[]) => void;
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
};

const DRAG_THRESHOLD = 4;
const SUPPRESS_TIMEOUT_MS = 400;

export const useEntryDragOut = (
  ref: RefObject<HTMLElement | null>,
  { selected, onSetSelection, onStartDrag, itemSelector, enabled = true }: UseEntryDragOutOptions,
) => {
  const selectedRef = useRef(selected);
  const onSetSelectionRef = useRef(onSetSelection);
  const onStartDragRef = useRef(onStartDrag);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const dragRef = useRef<DragState>({
    active: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    path: null,
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
    const element = ref.current;
    if (!element || !enabled) return;

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

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;
      const dx = Math.abs(event.clientX - drag.startX);
      const dy = Math.abs(event.clientY - drag.startY);
      if (!drag.dragging && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
        return;
      }
      if (drag.dragging) return;

      const path = drag.path;
      if (!path) {
        resetDrag();
        stopWindowTracking();
        return;
      }

      drag.dragging = true;
      armSuppress();
      resetDrag();
      stopWindowTracking();

      const selection = selectedRef.current;
      const dragPaths = selection.has(path) ? Array.from(selection) : [path];
      if (!selection.has(path)) {
        onSetSelectionRef.current(dragPaths, path);
      }
      onStartDragRef.current(dragPaths);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (dragRef.current.pointerId !== event.pointerId) return;
      resetDrag();
      stopWindowTracking();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (dragRef.current.pointerId !== event.pointerId) return;
      resetDrag();
      stopWindowTracking();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
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
      };
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
      resetDrag();
    };
  }, [enabled, itemSelector, ref]);
};
