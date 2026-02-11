import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { isEditableElement, makeDebug } from "@/lib";

export type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SelectionLayoutItem = {
  path: string;
  selectable: boolean;
};

export type SelectionLayout =
  | {
      kind: "list";
      items: SelectionLayoutItem[];
      itemHeight: number;
      rowHeight: number;
      insetTop?: number;
    }
  | {
      kind: "grid";
      items: SelectionLayoutItem[];
      columnCount: number;
      columnWidth: number;
      rowHeight: number;
      gap: number;
      insetTop?: number;
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

type ContentRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type ListLayoutSnapshot = {
  kind: "list";
  items: SelectionLayoutItem[];
  itemHeight: number;
  rowHeight: number;
  insetTop: number;
};

type GridLayoutSnapshot = {
  kind: "grid";
  items: SelectionLayoutItem[];
  columnCount: number;
  columnWidth: number;
  rowHeight: number;
  gap: number;
  insetTop: number;
  gridLeft: number;
  gridTop: number;
  columnStride: number;
  cardHeight: number;
};

type LayoutSnapshot = ListLayoutSnapshot | GridLayoutSnapshot;

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

const buildLayoutSnapshot = (
  element: HTMLElement,
  layout: SelectionLayout,
): LayoutSnapshot | null => {
  if (layout.kind === "list") {
    return {
      kind: "list",
      items: layout.items,
      itemHeight: layout.itemHeight,
      rowHeight: layout.rowHeight,
      insetTop: layout.insetTop ?? 0,
    };
  }

  if (layout.columnCount <= 0 || layout.columnWidth <= 0 || layout.rowHeight <= 0) {
    return null;
  }

  const styles = window.getComputedStyle(element);
  const paddingLeft = parsePixels(styles.paddingLeft);
  const paddingRight = parsePixels(styles.paddingRight);
  const paddingTop = parsePixels(styles.paddingTop);
  const contentWidth = Math.max(0, element.clientWidth - paddingLeft - paddingRight);
  const columnGap = Math.max(0, layout.gap);
  const columnWidth = Math.max(0, layout.columnWidth);
  const columnCount = layout.columnCount;
  const gridWidth =
    columnCount * columnWidth + columnGap * Math.max(0, columnCount - 1);
  const extraLeft = getGridCentered()
    ? Math.max(0, (contentWidth - gridWidth) / 2)
    : 0;
  const insetTop = layout.insetTop ?? 0;
  const rowHeight = layout.rowHeight;
  const cardHeight = Math.max(0, rowHeight - columnGap);

  return {
    kind: "grid",
    items: layout.items,
    columnCount,
    columnWidth,
    rowHeight,
    gap: columnGap,
    insetTop,
    gridLeft: paddingLeft + extraLeft,
    gridTop: paddingTop + insetTop,
    columnStride: columnWidth + columnGap,
    cardHeight,
  };
};

const selectFromListLayout = (
  layout: ListLayoutSnapshot,
  rect: ContentRect,
) => {
  const orderedPaths: string[] = [];
  const { items, itemHeight, rowHeight, insetTop } = layout;
  if (items.length === 0 || itemHeight <= 0 || rowHeight <= 0) {
    return orderedPaths;
  }

  const top = Math.min(rect.top, rect.bottom);
  const bottom = Math.max(rect.top, rect.bottom);
  const startIndex = Math.max(0, Math.floor((top - insetTop) / itemHeight));
  const endIndex = Math.min(
    items.length - 1,
    Math.floor((bottom - insetTop) / itemHeight),
  );

  for (let index = startIndex; index <= endIndex; index += 1) {
    const rowTop = insetTop + index * itemHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowBottom < top || rowTop > bottom) continue;
    const item = items[index];
    if (!item || !item.selectable) continue;
    orderedPaths.push(item.path);
  }

  return orderedPaths;
};

const selectFromGridLayout = (layout: GridLayoutSnapshot, rect: ContentRect) => {
  const orderedPaths: string[] = [];
  const {
    items,
    columnCount,
    columnStride,
    columnWidth,
    rowHeight,
    cardHeight,
    gridLeft,
    gridTop,
  } = layout;
  if (items.length === 0 || columnCount <= 0 || columnStride <= 0 || rowHeight <= 0) {
    return orderedPaths;
  }

  const rectLeft = Math.min(rect.left, rect.right);
  const rectRight = Math.max(rect.left, rect.right);
  const rectTop = Math.min(rect.top, rect.bottom);
  const rectBottom = Math.max(rect.top, rect.bottom);

  const relLeft = rectLeft - gridLeft;
  const relRight = rectRight - gridLeft;
  const relTop = rectTop - gridTop;
  const relBottom = rectBottom - gridTop;

  if (relRight < 0 || relBottom < 0) {
    return orderedPaths;
  }

  const maxRowIndex = Math.max(0, Math.ceil(items.length / columnCount) - 1);
  const startRow = Math.max(0, Math.floor(relTop / rowHeight));
  const endRow = Math.min(maxRowIndex, Math.floor(relBottom / rowHeight));
  const startCol = clamp(Math.floor(relLeft / columnStride), 0, columnCount - 1);
  const endCol = clamp(Math.floor(relRight / columnStride), 0, columnCount - 1);

  if (startRow > endRow || startCol > endCol) {
    return orderedPaths;
  }

  for (let row = startRow; row <= endRow; row += 1) {
    const itemTop = gridTop + row * rowHeight;
    const itemBottom = itemTop + cardHeight;
    if (itemBottom < rectTop || itemTop > rectBottom) continue;
    const rowIndex = row * columnCount;
    for (let col = startCol; col <= endCol; col += 1) {
      const itemLeft = gridLeft + col * columnStride;
      const itemRight = itemLeft + columnWidth;
      if (itemRight < rectLeft || itemLeft > rectRight) continue;
      const index = rowIndex + col;
      if (index >= items.length) continue;
      const item = items[index];
      if (!item.selectable) continue;
      orderedPaths.push(item.path);
    }
  }

  return orderedPaths;
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

  const updateSelection = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const drag = dragRef.current;
    if (!drag.active || !drag.dragging) return;

    const dragRoot = element.closest(".main") as HTMLElement | null;
    const bounds = (dragRoot ?? element).getBoundingClientRect();
    const elementBounds = element.getBoundingClientRect();
    const endClientX = clamp(drag.lastX, bounds.left, bounds.right);
    const endClientY = clamp(drag.lastY, bounds.top, bounds.bottom);
    // Convert the start/end points into content space so scrolling expands the box.
    const startContentX = drag.startX - elementBounds.left + drag.startScrollLeft;
    const startContentY = drag.startY - elementBounds.top + drag.startScrollTop;
    const endContentX = endClientX - elementBounds.left + element.scrollLeft;
    const endContentY = endClientY - elementBounds.top + element.scrollTop;
    const leftContent = Math.min(startContentX, endContentX);
    const rightContent = Math.max(startContentX, endContentX);
    const topContent = Math.min(startContentY, endContentY);
    const bottomContent = Math.max(startContentY, endContentY);
    // Convert back to viewport space for rendering and hit-testing.
    const left = leftContent - element.scrollLeft + elementBounds.left;
    const right = rightContent - element.scrollLeft + elementBounds.left;
    const top = topContent - element.scrollTop + elementBounds.top;
    const bottom = bottomContent - element.scrollTop + elementBounds.top;

    setSelectionBox({
      left,
      top,
      width: right - left,
      height: bottom - top,
    });

    const contentRect = {
      left: leftContent,
      right: rightContent,
      top: topContent,
      bottom: bottomContent,
    };
    let orderedPaths: string[] = [];
    if (drag.layoutSnapshot) {
      orderedPaths =
        drag.layoutSnapshot.kind === "list"
          ? selectFromListLayout(drag.layoutSnapshot, contentRect)
          : selectFromGridLayout(drag.layoutSnapshot, contentRect);
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

      items.forEach((item) => {
        const itemRect = item.rect;
        if (
          itemRect.right < left ||
          itemRect.left > right ||
          itemRect.bottom < top ||
          itemRect.top > bottom
        ) {
          return;
        }
        orderedPaths.push(item.path);
      });
    }

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
        startScrollLeft: element.scrollLeft,
        startScrollTop: element.scrollTop,
        layoutSnapshot: null,
      };
      baseSelectionRef.current = new Set(selectedRef.current);
      const layout = layoutRef.current;
      dragRef.current.layoutSnapshot = layout
        ? buildLayoutSnapshot(element, layout)
        : null;
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
