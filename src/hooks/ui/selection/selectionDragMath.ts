// Pure geometry and selection helpers for drag-selection.
// The hook owns DOM events and measurements, while this module keeps the math testable.

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

export type ContentRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type ViewportRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type RectLike = Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom">;

export type CachedSelectionItem = {
  path: string;
  rect: RectLike;
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

export type LayoutSnapshot = ListLayoutSnapshot | GridLayoutSnapshot;

type GridSnapshotMetrics = {
  clientWidth: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  centerGrid: boolean;
};

type DragSelectionGeometryInput = {
  dragBounds: ViewportRect;
  elementBounds: Pick<DOMRectReadOnly, "left" | "top">;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startScrollLeft: number;
  startScrollTop: number;
  scrollLeft: number;
  scrollTop: number;
};

type DragSelectionGeometry = {
  contentRect: ContentRect;
  selectionBox: SelectionBox;
  viewportRect: ViewportRect;
};

type SelectionResolution =
  | {
      kind: "noop";
    }
  | {
      kind: "set";
      paths: string[];
      anchor?: string;
    };

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

export const buildLayoutSnapshot = (
  layout: SelectionLayout,
  gridMetrics?: GridSnapshotMetrics,
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

  if (!gridMetrics) return null;
  if (layout.columnCount <= 0 || layout.columnWidth <= 0 || layout.rowHeight <= 0) {
    return null;
  }

  const contentWidth = Math.max(
    0,
    gridMetrics.clientWidth - gridMetrics.paddingLeft - gridMetrics.paddingRight,
  );
  const columnGap = Math.max(0, layout.gap);
  const columnWidth = Math.max(0, layout.columnWidth);
  const columnCount = layout.columnCount;
  const gridWidth =
    columnCount * columnWidth + columnGap * Math.max(0, columnCount - 1);
  const extraLeft = gridMetrics.centerGrid
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
    gridLeft: gridMetrics.paddingLeft + extraLeft,
    gridTop: gridMetrics.paddingTop + insetTop,
    columnStride: columnWidth + columnGap,
    cardHeight,
  };
};

export const computeDragSelectionGeometry = ({
  dragBounds,
  elementBounds,
  startX,
  startY,
  lastX,
  lastY,
  startScrollLeft,
  startScrollTop,
  scrollLeft,
  scrollTop,
}: DragSelectionGeometryInput): DragSelectionGeometry => {
  const endClientX = clamp(lastX, dragBounds.left, dragBounds.right);
  const endClientY = clamp(lastY, dragBounds.top, dragBounds.bottom);

  const startContentX = startX - elementBounds.left + startScrollLeft;
  const startContentY = startY - elementBounds.top + startScrollTop;
  const endContentX = endClientX - elementBounds.left + scrollLeft;
  const endContentY = endClientY - elementBounds.top + scrollTop;

  const leftContent = Math.min(startContentX, endContentX);
  const rightContent = Math.max(startContentX, endContentX);
  const topContent = Math.min(startContentY, endContentY);
  const bottomContent = Math.max(startContentY, endContentY);

  const left = leftContent - scrollLeft + elementBounds.left;
  const right = rightContent - scrollLeft + elementBounds.left;
  const top = topContent - scrollTop + elementBounds.top;
  const bottom = bottomContent - scrollTop + elementBounds.top;

  return {
    contentRect: {
      left: leftContent,
      right: rightContent,
      top: topContent,
      bottom: bottomContent,
    },
    selectionBox: {
      left,
      top,
      width: right - left,
      height: bottom - top,
    },
    viewportRect: {
      left,
      right,
      top,
      bottom,
    },
  };
};

const selectFromListLayout = (layout: ListLayoutSnapshot, rect: ContentRect) => {
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

export const selectPathsFromLayoutSnapshot = (
  layout: LayoutSnapshot,
  rect: ContentRect,
) =>
  layout.kind === "list"
    ? selectFromListLayout(layout, rect)
    : selectFromGridLayout(layout, rect);

export const selectPathsFromDomRects = (
  items: CachedSelectionItem[],
  rect: ViewportRect,
) => {
  const orderedPaths: string[] = [];

  items.forEach((item) => {
    if (
      item.rect.right < rect.left ||
      item.rect.left > rect.right ||
      item.rect.bottom < rect.top ||
      item.rect.top > rect.bottom
    ) {
      return;
    }
    orderedPaths.push(item.path);
  });

  return orderedPaths;
};

export const resolveSelectionUpdate = ({
  addMode,
  orderedPaths,
  baseSelection,
  currentSelection,
}: {
  addMode: boolean;
  orderedPaths: string[];
  baseSelection: Set<string>;
  currentSelection: Set<string>;
}): SelectionResolution => {
  const anchor = orderedPaths[orderedPaths.length - 1];

  if (addMode) {
    const next = new Set(baseSelection);
    orderedPaths.forEach((path) => next.add(path));
    if (setsMatch(next, currentSelection)) {
      return { kind: "noop" };
    }
    return {
      kind: "set",
      paths: Array.from(next),
      anchor,
    };
  }

  if (selectionMatches(orderedPaths, currentSelection)) {
    return { kind: "noop" };
  }

  return {
    kind: "set",
    paths: orderedPaths,
    anchor,
  };
};
