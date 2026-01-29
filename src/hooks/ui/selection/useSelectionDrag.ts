import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { isEditableElement, makeDebug } from "@/lib";

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
const log = makeDebug("selection");

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const selectionMatches = (paths: string[], current: Set<string>) => {
  if (paths.length !== current.size) return false;
  for (const path of paths) {
    if (!current.has(path)) return false;
  }
  return true;
};

const setsMatch = (next: Set<string>, current: Set<string>) => {
  if (next.size !== current.size) return false;
  for (const path of next) {
    if (!current.has(path)) return false;
  }
  return true;
};

export const useSelectionDrag = (
  ref: RefObject<HTMLElement | null>,
  { selected, setSelection, clearSelection, itemSelector }: SelectionDragOptions,
) => {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const selectedRef = useRef(selected);
  const setSelectionRef = useRef(setSelection);
  const clearSelectionRef = useRef(clearSelection);
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

  useEffect(() => {
    setSelectionRef.current = setSelection;
  }, [setSelection]);

  useEffect(() => {
    clearSelectionRef.current = clearSelection;
  }, [clearSelection]);

  const updateSelection = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const drag = dragRef.current;
    if (!drag.active || !drag.dragging) return;

    const dragRoot = element.closest(".main") as HTMLElement | null;
    const bounds = (dragRoot ?? element).getBoundingClientRect();
    const startX = clamp(drag.startX, bounds.left, bounds.right);
    const startY = clamp(drag.startY, bounds.top, bounds.bottom);
    const endX = clamp(drag.lastX, bounds.left, bounds.right);
    const endY = clamp(drag.lastY, bounds.top, bounds.bottom);
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    const top = Math.min(startY, endY);
    const bottom = Math.max(startY, endY);

    setSelectionBox({
      left,
      top,
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
        if (selectedRef.current.size > 0) {
          if (log.enabled) {
            log("update: no items -> clear selection");
          }
          setSelectionRef.current([], undefined);
        }
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
      if (setsMatch(next, selectedRef.current)) {
        return;
      }
      if (log.enabled) {
        log("update: setSelection add=%s count=%d", "yes", next.size);
      }
      setSelectionRef.current(Array.from(next), anchor);
      return;
    }

    if (selectionMatches(orderedPaths, selectedRef.current)) {
      return;
    }
    if (log.enabled) {
      log("update: setSelection add=%s count=%d", "no", orderedPaths.length);
    }
    setSelectionRef.current(orderedPaths, anchor);
  }, [itemSelector, ref]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const dragRoot = element.closest(".main") as HTMLElement | null;
    const dragElement = dragRoot ?? element;

    const resetDrag = (clear: boolean, reason: string) => {
      if (log.enabled) {
        log("reset: reason=%s clear=%s dragging=%s", reason, clear ? "yes" : "no", dragRef.current.dragging ? "yes" : "no");
      }
      dragRef.current.active = false;
      dragRef.current.dragging = false;
      setSelectionBox(null);
      cacheRef.current = null;
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (
        pointerIdRef.current != null &&
        dragElement.hasPointerCapture(pointerIdRef.current)
      ) {
        dragElement.releasePointerCapture(pointerIdRef.current);
      }
      pointerIdRef.current = null;
      if (clear) {
        clearSelectionRef.current();
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
      if (!target) return;
      if (target?.closest(itemSelector)) {
        if (log.enabled) {
          log("pointerdown ignored: on-item");
        }
        return;
      }
      if (target.closest("[data-selection-ignore=\"true\"]")) {
        if (log.enabled) {
          log("pointerdown ignored: selection-ignore");
        }
        return;
      }
      if (isEditableElement(target) || target.closest("button, a, [role=\"button\"]")) {
        if (log.enabled) {
          log("pointerdown ignored: interactive");
        }
        return;
      }

      if (log.enabled) {
        log("pointerdown: add=%s id=%s", event.ctrlKey || event.metaKey || event.altKey ? "yes" : "no", event.pointerId);
      }

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
      dragElement.setPointerCapture(event.pointerId);
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
      if (!drag.dragging && log.enabled) {
        log("drag-start: dx=%d dy=%d", Math.round(dx), Math.round(dy));
      }
      drag.dragging = true;
      scheduleUpdate();
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      const drag = dragRef.current;
      const wasDragging = drag.dragging;
      resetDrag(false, "pointer-up");
      if (!wasDragging && !drag.addMode) {
        clearSelectionRef.current();
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      const drag = dragRef.current;
      const wasDragging = drag.dragging;
      resetDrag(false, "pointer-cancel");
      if (!wasDragging && !drag.addMode) {
        clearSelectionRef.current();
      }
    };

    const handleCancel = (reason: string) => {
      if (!dragRef.current.active) return;
      resetDrag(true, reason);
    };

    const handleScroll = () => handleCancel("scroll");
    const handleWheel = () => handleCancel("wheel");

    dragElement.addEventListener("pointerdown", handlePointerDown);
    dragElement.addEventListener("pointermove", handlePointerMove);
    dragElement.addEventListener("pointerup", handlePointerUp);
    dragElement.addEventListener("pointercancel", handlePointerCancel);
    element.addEventListener("scroll", handleScroll, { passive: true });
    element.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      dragElement.removeEventListener("pointerdown", handlePointerDown);
      dragElement.removeEventListener("pointermove", handlePointerMove);
      dragElement.removeEventListener("pointerup", handlePointerUp);
      dragElement.removeEventListener("pointercancel", handlePointerCancel);
      element.removeEventListener("scroll", handleScroll);
      element.removeEventListener("wheel", handleWheel);
      resetDrag(false, "cleanup");
    };
  }, [itemSelector, ref, updateSelection]);

  return {
    selectionBox,
  };
};
