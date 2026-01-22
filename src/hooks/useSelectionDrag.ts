import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CachedItem = {
  path: string;
  rect: DOMRect;
};

type CacheState = {
  items: CachedItem[];
  scrollTop: number;
  scrollLeft: number;
};

type SelectionDragOptions = {
  selected: Set<string>;
  setSelection: (paths: string[], anchor?: string) => void;
  clearSelection: () => void;
  itemSelector: string;
};

type DragState = {
  active: boolean;
  dragging: boolean;
  addMode: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
};

const DRAG_THRESHOLD = 4;

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

export const useSelectionDrag = (
  ref: RefObject<HTMLElement | null>,
  { selected, setSelection, clearSelection, itemSelector }: SelectionDragOptions,
) => {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const selectedRef = useRef(selected);
  // Cache item rects during a drag so we avoid repeated DOM queries.
  const cacheRef = useRef<CacheState | null>(null);
  const dragRef = useRef<DragState>({
    active: false,
    dragging: false,
    addMode: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });
  const baseSelectionRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const updateSelection = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const drag = dragRef.current;
    if (!drag.active || !drag.dragging) return;

    const bounds = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const startX = clamp(drag.startX, bounds.left, bounds.right);
    const startY = clamp(drag.startY, bounds.top, bounds.bottom);
    const endX = clamp(drag.lastX, bounds.left, bounds.right);
    const endY = clamp(drag.lastY, bounds.top, bounds.bottom);
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    const top = Math.min(startY, endY);
    const bottom = Math.max(startY, endY);

    setSelectionBox({
      left: left - bounds.left - paddingLeft + element.scrollLeft,
      top: top - bounds.top - paddingTop + element.scrollTop,
      width: right - left,
      height: bottom - top,
    });

    const cached = cacheRef.current;
    if (
      !cached ||
      cached.scrollTop !== element.scrollTop ||
      cached.scrollLeft !== element.scrollLeft
    ) {
      const items: CachedItem[] = [];
      element.querySelectorAll<HTMLElement>(itemSelector).forEach((node) => {
        const path = node.dataset.path;
        if (!path) return;
        items.push({ path, rect: node.getBoundingClientRect() });
      });
      cacheRef.current = {
        items,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
      };
    }

    const items = cacheRef.current?.items ?? [];
    if (!items.length) {
      if (!drag.addMode) {
        setSelection([], undefined);
      }
      return;
    }

    const orderedPaths: string[] = [];
    items.forEach((item) => {
      const rect = item.rect;
      if (rect.right < left || rect.left > right || rect.bottom < top || rect.top > bottom) {
        return;
      }
      orderedPaths.push(item.path);
    });
    // Keep DOM order so keyboard navigation matches the on-screen order.
    const anchor = orderedPaths[orderedPaths.length - 1];

    if (drag.addMode) {
      const next = new Set(baseSelectionRef.current);
      orderedPaths.forEach((path) => next.add(path));
      setSelection(Array.from(next), anchor);
      return;
    }

    setSelection(orderedPaths, anchor);
  }, [itemSelector, ref, setSelection]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const resetDrag = (clear = false) => {
      dragRef.current.active = false;
      dragRef.current.dragging = false;
      setSelectionBox(null);
      cacheRef.current = null;
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (pointerIdRef.current != null && element.hasPointerCapture(pointerIdRef.current)) {
        element.releasePointerCapture(pointerIdRef.current);
      }
      pointerIdRef.current = null;
      if (clear) {
        clearSelection();
      }
    };

    const scheduleUpdate = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        updateSelection();
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(itemSelector)) return;

      dragRef.current = {
        active: true,
        dragging: false,
        addMode: event.ctrlKey || event.metaKey || event.altKey,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      baseSelectionRef.current = new Set(selectedRef.current);
      cacheRef.current = null;
      pointerIdRef.current = event.pointerId;
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      const drag = dragRef.current;
      if (!drag.active) return;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      const dx = Math.abs(drag.lastX - drag.startX);
      const dy = Math.abs(drag.lastY - drag.startY);
      if (!drag.dragging && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
        return;
      }
      drag.dragging = true;
      scheduleUpdate();
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      const drag = dragRef.current;
      const wasDragging = drag.dragging;
      resetDrag(false);
      if (!wasDragging && !drag.addMode) {
        clearSelection();
      }
    };

    const handleCancel = () => {
      if (!dragRef.current.active) return;
      resetDrag(true);
    };

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", handlePointerUp);
    element.addEventListener("pointercancel", handlePointerUp);
    element.addEventListener("scroll", handleCancel, { passive: true });
    element.addEventListener("wheel", handleCancel, { passive: true });

    return () => {
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("pointermove", handlePointerMove);
      element.removeEventListener("pointerup", handlePointerUp);
      element.removeEventListener("pointercancel", handlePointerUp);
      element.removeEventListener("scroll", handleCancel);
      element.removeEventListener("wheel", handleCancel);
      resetDrag(false);
    };
  }, [clearSelection, itemSelector, ref, updateSelection]);

  return {
    selectionBox,
  };
};
