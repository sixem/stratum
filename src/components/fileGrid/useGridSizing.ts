// Grid sizing calculations and layout effects for the file grid.
import type { CSSProperties, RefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useElementSize, useScrollRestore, useWheelSnap } from "@/hooks";
import { GRID_AUTO_COLUMNS_MAX, GRID_AUTO_COLUMNS_MIN } from "@/modules";
import type { GridSize, ThumbnailFit } from "@/modules";

type GridPreset = {
  column: number;
  gap: number;
  padding: number;
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
    padding: 6,
  },
  normal: {
    column: 220,
    gap: 14,
    padding: 8,
  },
  large: {
    column: 260,
    gap: 16,
    padding: 10,
  },
};

// Keep these layout numbers in sync with the grid card styles in components/_file-view.scss.
const GRID_CARD_BORDER = 1;
const GRID_CARD_GAP = 3;
const GRID_META_GAP = 1;
const GRID_ICON_RATIO = 3 / 4;
const GRID_NAME_LINE_HEIGHT = 14;
const GRID_INFO_LINE_HEIGHT = 13;
const AUTO_GRID_RESIZE_DEBOUNCE_MS = 180;

const getGridIconHeight = (column: number, padding: number) => {
  const innerWidth = column - padding * 2 - GRID_CARD_BORDER * 2;
  return Math.max(0, Math.round(innerWidth * GRID_ICON_RATIO));
};

const getGridMetaHeight = (showMeta: boolean) => {
  if (!showMeta) return GRID_NAME_LINE_HEIGHT;
  return GRID_NAME_LINE_HEIGHT + GRID_META_GAP + GRID_INFO_LINE_HEIGHT;
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
const buildGridSizing = (preset: GridPreset, showMeta: boolean): GridSizing => {
  const iconHeight = getGridIconHeight(preset.column, preset.padding);
  const metaHeight = getGridMetaHeight(showMeta);
  return {
    ...preset,
    iconHeight,
    metaHeight,
    rowHeight:
      iconHeight +
      metaHeight +
      GRID_CARD_GAP +
      preset.padding * 2 +
      GRID_CARD_BORDER * 2,
  };
};

type UseGridSizingOptions = {
  gridSize: GridSize;
  gridAutoColumns: number;
  gridGap: number;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  thumbnailFit: ThumbnailFit;
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
  columnCount: number;
  rowCount: number;
  rowHeight: number;
  gridMetaEnabled: boolean;
};

export const useGridSizing = ({
  gridSize,
  gridAutoColumns,
  gridGap,
  gridShowSize,
  gridShowExtension,
  thumbnailFit,
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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { width: viewportWidth } = useElementSize(viewportRef);
  const [stableViewportWidth, setStableViewportWidth] = useState(
    () => autoViewportWidth ?? viewportWidth,
  );
  const viewportWidthRef = useRef(viewportWidth);
  const resizeDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    viewportWidthRef.current = viewportWidth;
  }, [viewportWidth]);

  useEffect(() => {
    // Debounce auto grid sizing during window resize to avoid layout churn.
    if (gridSize !== "auto") {
      if (resizeDebounceRef.current != null) {
        window.clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
      setStableViewportWidth(viewportWidth);
      return;
    }

    if (resizeDebounceRef.current != null) {
      window.clearTimeout(resizeDebounceRef.current);
    }
    resizeDebounceRef.current = window.setTimeout(() => {
      resizeDebounceRef.current = null;
      setStableViewportWidth(viewportWidth);
    }, AUTO_GRID_RESIZE_DEBOUNCE_MS);

    return () => {
      if (resizeDebounceRef.current != null) {
        window.clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
    };
  }, [gridSize, viewportWidth]);

  useEffect(() => {
    // Snap to the current viewport on tab/view switches without breaking resize debounce.
    if (resizeDebounceRef.current != null) {
      window.clearTimeout(resizeDebounceRef.current);
      resizeDebounceRef.current = null;
    }
    const nextWidth = viewportWidthRef.current;
    if (gridSize === "auto" && nextWidth <= 0) return;
    setStableViewportWidth(nextWidth);
  }, [gridSize, viewKey]);

  useEffect(() => {
    if (!onAutoViewportWidthChange) return;
    if (gridSize !== "auto") return;
    if (stableViewportWidth <= 0) return;
    // Persist the most recent auto-fit width so we can reuse it across view resets.
    onAutoViewportWidthChange(stableViewportWidth);
  }, [gridSize, onAutoViewportWidthChange, stableViewportWidth]);

  // Keep the outer grid padding aligned with the configured grid gap.
  const viewportPadding = gridGap;
  const layoutViewportWidth = gridSize === "auto" ? stableViewportWidth : viewportWidth;
  const gridSizing = useMemo(() => {
    const basePreset = GRID_PRESETS[gridSize === "auto" ? "normal" : gridSize] ?? GRID_PRESETS.small;
    // Apply the user-configured gap while preserving preset padding/column sizing.
    const gapPreset = {
      ...basePreset,
      gap: gridGap,
    };
    const preset =
      gridSize === "auto"
        ? buildAutoPreset(gapPreset, layoutViewportWidth, gridAutoColumns, viewportPadding)
        : gapPreset;
    return buildGridSizing(preset, gridMetaEnabled);
  }, [
    gridAutoColumns,
    gridGap,
    gridMetaEnabled,
    gridSize,
    layoutViewportWidth,
    viewportPadding,
  ]);

  const gridVars = useMemo(
    () =>
      ({
        "--thumb-column": `${gridSizing.column}px`,
        "--thumb-gap": `${gridSizing.gap}px`,
        "--thumb-row-height": `${gridSizing.rowHeight}px`,
        "--thumb-padding": `${viewportPadding}px`,
        "--thumb-icon-height": `${gridSizing.iconHeight}px`,
        "--thumb-meta-height": `${gridSizing.metaHeight}px`,
        "--thumb-fit": thumbnailFit,
        "--thumb-preview-bg": thumbnailFit === "contain" ? "transparent" : "#0f131d",
      }) as CSSProperties,
    [gridSizing, thumbnailFit, viewportPadding],
  );

  const contentWidth = Math.max(0, layoutViewportWidth - viewportPadding * 2);
  const columnCount =
    gridSize === "auto"
      ? clampAutoColumns(gridAutoColumns)
      : Math.max(
          1,
          Math.floor((contentWidth + gridSizing.gap) / (gridSizing.column + gridSizing.gap)),
        );
  const rowCount = Math.ceil(viewItemsLength / columnCount);
  const rowHeight = gridSizing.rowHeight + gridSizing.gap;
  const layoutReady = viewportWidth > 0;

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
    columnCount,
    rowCount,
    rowHeight,
    gridMetaEnabled,
  };
};
