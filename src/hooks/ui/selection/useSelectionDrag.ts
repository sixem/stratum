import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { isEditableElement, makeDebug } from "@/lib";
import {
  buildLayoutSnapshot,
  computeDragSelectionGeometry,
  resolveSelectionUpdate,
  selectPathsFromDomRects,
  selectPathsFromLayoutSnapshot,
} from "./selectionDragMath";
import type {
  CachedSelectionItem,
  LayoutSnapshot,
  SelectionBox,
  SelectionLayout,
} from "./selectionDragMath";

export type { SelectionBox, SelectionLayout, SelectionLayoutItem } from "./selectionDragMath";

type CachedItem = CachedSelectionItem;

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
  layout?: SelectionLayout;
};

type DragState = {
  active: boolean;
  dragging: boolean;
  addMode: boolean;
  // Store pointer coordinates in viewport space (clientX/clientY).
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  // Capture scroll offsets at drag start so scroll-driven selection can expand.
  startScrollLeft: number;
  startScrollTop: number;
  layoutSnapshot: LayoutSnapshot | null;
};

const DRAG_THRESHOLD = 4;
const log = makeDebug("selection");

const parsePixels = (value: string | null) => {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getGridCentered = () => {
  const root = document.documentElement;
  return root?.dataset.gridCenter !== "false";
};

// Native scrollbar interactions should scroll only, not start selection drag.
const isPointerOnNativeScrollbar = (element: HTMLElement, event: PointerEvent) => {
  const bounds = element.getBoundingClientRect();
  const contentLeft = bounds.left + element.clientLeft;
  const contentTop = bounds.top + element.clientTop;
  const contentRight = contentLeft + element.clientWidth;
  const contentBottom = contentTop + element.clientHeight;
  const onVerticalScrollbar =
    element.scrollHeight > element.clientHeight &&
    event.clientX >= contentRight &&
    event.clientX <= bounds.right;
  const onHorizontalScrollbar =
    element.scrollWidth > element.clientWidth &&
    event.clientY >= contentBottom &&
    event.clientY <= bounds.bottom;
  return onVerticalScrollbar || onHorizontalScrollbar;
};

export const useSelectionDrag = (
  ref: RefObject<HTMLElement | null>,
  { selected, setSelection, clearSelection, itemSelector, layout }: SelectionDragOptions,
) => {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const selectedRef = useRef(selected);
  const setSelectionRef = useRef(setSelection);
  const clearSelectionRef = useRef(clearSelection);
  const layoutRef = useRef<SelectionLayout | undefined>(layout);
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
    startScrollLeft: 0,
    startScrollTop: 0,
    layoutSnapshot: null,
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

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // Convert the current drag gesture into a visible box and the matching paths.
  const updateSelection = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const drag = dragRef.current;
    if (!drag.active || !drag.dragging) return;

    const dragRoot = element.closest(".main") as HTMLElement | null;
    const elementBounds = element.getBoundingClientRect();
    const selectionGeometry = computeDragSelectionGeometry({
      dragBounds: (dragRoot ?? element).getBoundingClientRect(),
      elementBounds,
      startX: drag.startX,
      startY: drag.startY,
      lastX: drag.lastX,
      lastY: drag.lastY,
      startScrollLeft: drag.startScrollLeft,
      startScrollTop: drag.startScrollTop,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    });

    setSelectionBox(selectionGeometry.selectionBox);

    let orderedPaths: string[] = [];
    if (drag.layoutSnapshot) {
      orderedPaths = selectPathsFromLayoutSnapshot(
        drag.layoutSnapshot,
        selectionGeometry.contentRect,
      );
    } else {
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

      orderedPaths = selectPathsFromDomRects(
        cacheRef.current?.items ?? [],
        selectionGeometry.viewportRect,
      );
    }

    const nextSelection = resolveSelectionUpdate({
      addMode: drag.addMode,
      orderedPaths,
      baseSelection: baseSelectionRef.current,
      currentSelection: selectedRef.current,
    });

    if (nextSelection.kind === "noop") {
      return;
    }

    if (log.enabled) {
      log(
        "update: setSelection add=%s count=%d",
        drag.addMode ? "yes" : "no",
        nextSelection.paths.length,
      );
    }
    setSelectionRef.current(nextSelection.paths, nextSelection.anchor);
  }, [itemSelector, ref]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const dragRoot = element.closest(".main") as HTMLElement | null;
    const dragElement = dragRoot ?? element;

    const resetDrag = (clear: boolean, reason: string) => {
      if (log.enabled) {
        log(
          "reset: reason=%s clear=%s dragging=%s",
          reason,
          clear ? "yes" : "no",
          dragRef.current.dragging ? "yes" : "no",
        );
      }
      dragRef.current.active = false;
      dragRef.current.dragging = false;
      dragRef.current.layoutSnapshot = null;
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
      if (isPointerOnNativeScrollbar(element, event)) {
        if (log.enabled) {
          log("pointerdown ignored: native-scrollbar");
        }
        return;
      }
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
        log(
          "pointerdown: add=%s id=%s",
          event.ctrlKey || event.metaKey || event.altKey ? "yes" : "no",
          event.pointerId,
        );
      }

      dragRef.current = {
        active: true,
        dragging: false,
        addMode: event.ctrlKey || event.metaKey || event.altKey,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        startScrollLeft: element.scrollLeft,
        startScrollTop: element.scrollTop,
        layoutSnapshot: null,
      };
      baseSelectionRef.current = new Set(selectedRef.current);
      const layout = layoutRef.current;
      if (layout) {
        const styles =
          layout.kind === "grid" ? window.getComputedStyle(element) : null;
        dragRef.current.layoutSnapshot = buildLayoutSnapshot(
          layout,
          styles
            ? {
                clientWidth: element.clientWidth,
                paddingLeft: parsePixels(styles.paddingLeft),
                paddingRight: parsePixels(styles.paddingRight),
                paddingTop: parsePixels(styles.paddingTop),
                centerGrid: getGridCentered(),
              }
            : undefined,
        );
      } else {
        dragRef.current.layoutSnapshot = null;
      }
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

    const handleScroll = () => {
      if (!dragRef.current.active) return;
      scheduleUpdate();
    };
    const handleWheel = () => {
      if (!dragRef.current.active) return;
      scheduleUpdate();
    };

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
