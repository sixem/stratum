// Grid sizing calculations and layout effects for the file grid.
import type { CSSProperties, RefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useScrollRestore, useWheelSnap } from "@/hooks";
import { makeDebug } from "@/lib";
import { GRID_AUTO_COLUMNS_MAX, GRID_AUTO_COLUMNS_MIN } from "@/modules";
import type { GridSize, ThumbnailFit } from "@/modules";
import { getFileViewLayoutMetrics } from "../fileViewLayoutMetrics";
import { useGridViewportLayout } from "./useGridViewportLayout";

type GridPreset = {
  column: number;
  gap: number;
};

type GridSizing = GridPreset & {
  iconHeight: number;
  metaHeight: number;
  rowHeight: number;
};

const GRID_PRESETS: Record<Exclude<GridSize, "auto">, GridPreset> = {
  small: {
    column: 180,
    gap: 12,
  },
  normal: {
    column: 220,
    gap: 14,
  },
  large: {
    column: 260,
    gap: 16,
  },
};

const GRID_PERF_LOG_INTERVAL_MS = 120;
const perf = makeDebug("perf:resize:grid");

const getGridIconHeight = (
  column: number,
  layoutMetrics: ReturnType<typeof getFileViewLayoutMetrics>,
) => {
  const innerWidth =
    column - layoutMetrics.gridCardPadding * 2 - layoutMetrics.gridCardBorder * 2;
  const iconRatio =
    layoutMetrics.gridIconHeightRatio / Math.max(1, layoutMetrics.gridIconWidthRatio);
  return Math.max(0, Math.round(innerWidth * iconRatio));
};

const getGridMetaHeight = (
  showMeta: boolean,
  layoutMetrics: ReturnType<typeof getFileViewLayoutMetrics>,
) => {
  if (!showMeta) return layoutMetrics.gridNameLineHeight;
  return (
    layoutMetrics.gridNameLineHeight +
    layoutMetrics.gridMetaGap +
    layoutMetrics.gridInfoLineHeight
  );
};

// Keep auto grid columns within the supported range for readability.
const clampAutoColumns = (value: number) => {
  return Math.min(GRID_AUTO_COLUMNS_MAX, Math.max(GRID_AUTO_COLUMNS_MIN, Math.round(value)));
};

// Compute a preset that fits a fixed column count into the available width.
const buildAutoPreset = (
  base: GridPreset,
  viewportWidth: number,
  columns: number,
  viewportPadding: number,
): GridPreset => {
  const safeColumns = clampAutoColumns(columns);
  if (viewportWidth <= 0) {
    return { ...base };
  }
  const contentWidth = Math.max(0, viewportWidth - viewportPadding * 2);
  const totalGap = base.gap * Math.max(0, safeColumns - 1);
  const available = Math.max(0, contentWidth - totalGap);
  const column = Math.max(1, Math.floor(available / safeColumns));
  return { ...base, column };
};

// Derive the virtual row height from the card's real content sizing.
const buildGridSizing = (
  preset: GridPreset,
  showMeta: boolean,
  layoutMetrics: ReturnType<typeof getFileViewLayoutMetrics>,
): GridSizing => {
  const iconHeight = getGridIconHeight(preset.column, layoutMetrics);
  const metaHeight = getGridMetaHeight(showMeta, layoutMetrics);
  return {
    ...preset,
    iconHeight,
    metaHeight,
    rowHeight:
      iconHeight +
      metaHeight +
      layoutMetrics.gridCardGap +
      layoutMetrics.gridCardPadding * 2 +
      layoutMetrics.gridCardBorder * 2,
  };
};

type UseGridSizingOptions = {
  gridSize: GridSize;
  gridAutoColumns: number;
  gridGap: number;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  thumbnailFit: ThumbnailFit;
  instantResizeKey?: string | number | boolean;
  viewKey: string;
  scrollRestoreKey: string;
  scrollRestoreTop: number;
  loading: boolean;
  smoothScroll: boolean;
  autoViewportWidth?: number;
  onAutoViewportWidthChange?: (width: number) => void;
  onGridColumnsChange?: (columns: number) => void;
  viewItemsLength: number;
};

export type GridSizingState = {
  viewportRef: RefObject<HTMLDivElement | null>;
  gridVars: CSSProperties;
  gridStyle: CSSProperties;
  viewportHeight: number;
  columnCount: number;
  columnWidth: number;
  columnGap: number;
  rowCount: number;
  rowHeight: number;
  gridMetaEnabled: boolean;
  isResizing: boolean;
};

export const useGridSizing = ({
  gridSize,
  gridAutoColumns,
  gridGap,
  gridShowSize,
  gridShowExtension,
  thumbnailFit,
  instantResizeKey,
  viewKey,
  scrollRestoreKey,
  scrollRestoreTop,
  loading,
  smoothScroll,
  autoViewportWidth,
  onAutoViewportWidthChange,
  onGridColumnsChange,
  viewItemsLength,
}: UseGridSizingOptions): GridSizingState => {
  const gridMetaEnabled = gridShowSize || gridShowExtension;
  const layoutMetrics = useMemo(() => getFileViewLayoutMetrics(), []);
  const {
    viewportRef,
    viewportWidth,
    viewportHeight,
    stableViewportWidth,
    isResizing,
  } = useGridViewportLayout({
    gridSize,
    autoViewportWidth,
    instantResizeKey,
    viewKey,
    onAutoViewportWidthChange,
  });
  const lastViewportLogAtRef = useRef(0);
  const lastLayoutLogRef = useRef("");

  // Keep the outer grid padding aligned with the configured grid gap.
  const viewportPadding = gridGap;
  const layoutViewportWidth = gridSize === "auto" ? stableViewportWidth : viewportWidth;
  // Keep virtual row height tied to the declared card structure so resize does
  // not trigger a second correction pass after cards have already rendered.
  const gridSizing = useMemo(() => {
    const basePreset = GRID_PRESETS[gridSize === "auto" ? "normal" : gridSize] ?? GRID_PRESETS.small;
    // Apply the user-configured gap while preserving the preset column width.
    const gapPreset = {
      ...basePreset,
      gap: gridGap,
    };
    const preset =
      gridSize === "auto"
        ? buildAutoPreset(gapPreset, layoutViewportWidth, gridAutoColumns, viewportPadding)
        : gapPreset;
    return buildGridSizing(preset, gridMetaEnabled, layoutMetrics);
  }, [
    gridAutoColumns,
    gridGap,
    gridMetaEnabled,
    gridSize,
    layoutMetrics,
    layoutViewportWidth,
    viewportPadding,
  ]);

  const gridVars = useMemo(
    () => {
      return {
        "--thumb-column": `${gridSizing.column}px`,
        "--thumb-gap": `${gridSizing.gap}px`,
        "--thumb-column-gap": `${gridSizing.gap}px`,
        "--thumb-row-gap": `${gridSizing.gap}px`,
        "--thumb-row-height": `${gridSizing.rowHeight}px`,
        "--thumb-icon-height": `${gridSizing.iconHeight}px`,
        "--thumb-meta-height": `${gridSizing.metaHeight}px`,
        "--thumb-fit": thumbnailFit,
        "--thumb-preview-bg": "transparent",
      } as CSSProperties;
    },
    [gridSizing, thumbnailFit],
  );

  const columnGap = useMemo(() => {
    return gridSizing.gap;
  }, [gridSizing.gap]);
  const contentWidth = Math.max(0, layoutViewportWidth - viewportPadding * 2);
  const columnCount =
    gridSize === "auto"
      ? clampAutoColumns(gridAutoColumns)
      : Math.max(
          1,
          Math.floor((contentWidth + columnGap) / (gridSizing.column + columnGap)),
        );
  const rowCount = Math.ceil(viewItemsLength / columnCount);
  const rowHeight = gridSizing.rowHeight + gridSizing.gap;
  const layoutReady = viewportWidth > 0;

  useEffect(() => {
    if (!perf.enabled) return;
    const now = performance.now();
    if (now - lastViewportLogAtRef.current < GRID_PERF_LOG_INTERVAL_MS) return;
    lastViewportLogAtRef.current = now;
    perf(
      "viewport view=%s raw=%d stable=%d auto=%s resizing=%s items=%d",
      viewKey,
      viewportWidth,
      stableViewportWidth,
      gridSize === "auto" ? "yes" : "no",
      isResizing ? "yes" : "no",
      viewItemsLength,
    );
  }, [gridSize, isResizing, stableViewportWidth, viewItemsLength, viewKey, viewportWidth]);

  useEffect(() => {
    if (!perf.enabled) return;
    const layoutKey = [
      viewKey,
      layoutViewportWidth,
      columnCount,
      rowCount,
      rowHeight,
      gridSizing.rowHeight,
      viewItemsLength,
    ].join(":");
    if (lastLayoutLogRef.current === layoutKey) return;
    lastLayoutLogRef.current = layoutKey;
    perf(
      "layout view=%s viewport=%d cols=%d rows=%d rowHeight=%d mode=deterministic items=%d",
      viewKey,
      layoutViewportWidth,
      columnCount,
      rowCount,
      rowHeight,
      viewItemsLength,
    );
  }, [
    columnCount,
    gridSizing.rowHeight,
    layoutViewportWidth,
    rowCount,
    rowHeight,
    viewItemsLength,
    viewKey,
  ]);

  // When smooth scrolling is disabled, snap wheel input to a single grid row.
  useWheelSnap(viewportRef, smoothScroll ? 0 : rowHeight);
  // Restore the stored scroll offset once the grid has a measurable height.
  useScrollRestore(viewportRef, {
    restoreKey: scrollRestoreKey,
    restoreTop: scrollRestoreTop,
    restoreReady: !loading && layoutReady,
  });

  const lastLayoutRef = useRef({ gridSize, columnCount, rowHeight });

  // Keep the same entries in view when density changes by anchoring the viewport center.
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      lastLayoutRef.current = { gridSize, columnCount, rowHeight };
      return;
    }
    const last = lastLayoutRef.current;
    const gridSizeChanged = last.gridSize !== gridSize;
    if (gridSizeChanged && last.rowHeight > 0 && last.columnCount > 0 && viewItemsLength > 0) {
      const viewportHeight = Math.max(0, element.clientHeight);
      // Anchor to the middle of the viewport so the same items stay in view.
      const anchorOffset = viewportHeight * 0.5;
      const currentScrollTop = element.scrollTop;
      const anchorTop = Math.max(0, currentScrollTop + anchorOffset);
      const prevRowIndex = Math.max(0, Math.floor(anchorTop / last.rowHeight));
      const prevOffset = anchorTop - prevRowIndex * last.rowHeight;
      // Use the middle column as the horizontal anchor for the row.
      const anchorColumn = Math.min(
        last.columnCount - 1,
        Math.floor(last.columnCount / 2),
      );
      const maxAnchorIndex = Math.max(0, viewItemsLength - 1);
      const anchorIndex = Math.min(
        maxAnchorIndex,
        prevRowIndex * last.columnCount + anchorColumn,
      );
      const nextRowIndex = Math.max(0, Math.floor(anchorIndex / columnCount));
      const offsetRatio = last.rowHeight > 0 ? prevOffset / last.rowHeight : 0;
      const nextAnchorTop = nextRowIndex * rowHeight + rowHeight * offsetRatio;
      const nextScrollTop = nextAnchorTop - anchorOffset;
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const clamped = Math.min(Math.max(0, nextScrollTop), maxScrollTop);
      if (Math.abs(clamped - element.scrollTop) > 0.5) {
        element.scrollTop = clamped;
      }
    }
    lastLayoutRef.current = { gridSize, columnCount, rowHeight };
  }, [columnCount, gridSize, rowHeight, viewItemsLength]);

  useEffect(() => {
    if (!onGridColumnsChange) return;
    onGridColumnsChange(columnCount);
  }, [columnCount, onGridColumnsChange]);

  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${columnCount}, var(--thumb-column))`,
    }),
    [columnCount],
  );

  return {
    viewportRef,
    gridVars,
    gridStyle,
    viewportHeight,
    columnCount,
    columnWidth: gridSizing.column,
    columnGap,
    rowCount,
    rowHeight,
    gridMetaEnabled,
    isResizing,
  };
};
