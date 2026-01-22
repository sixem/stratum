// Virtualized grid view for file entries.
import type { CSSProperties } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  useElementSize,
  useEntryDragOut,
  useEntryMetaRequest,
  useDynamicOverscan,
  useScrollAnchor,
  useScrollSettled,
  useScrollPosition,
  useScrollToIndex,
  useSelectionDrag,
  useThumbnailRequest,
  useWheelSnap,
  useVirtualRange,
} from "@/hooks";
import { getEmptyMessage, handleMiddleClick, isEntryItem } from "@/lib";
import type { EntryItem } from "@/lib";
import type { GridNameEllipsis, GridSize } from "@/modules";
import type { EntryMeta, FileEntry } from "@/types";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";
import { SelectionRect } from "./SelectionRect";
import { EntryCard, ParentCard } from "./fileGrid/index";

type FileGridProps = {
  entries: FileEntry[];
  items: EntryItem[];
  itemIndexMap: Map<string, number>;
  loading: boolean;
  searchQuery: string;
  scrollKey: string;
  initialScrollTop: number;
  scrollReady: boolean;
  scrollRequest?: { index: number; nonce: number } | null;
  smoothScroll: boolean;
  selectedPaths: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab?: (path: string) => void;
  onOpenEntry: (path: string) => void;
  onSelectItem: (path: string, index: number, event: ReactMouseEvent) => void;
  onClearSelection: () => void;
  onScrollTopChange: (key: string, scrollTop: number) => void;
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  thumbnailsEnabled: boolean;
  thumbnails: Map<string, string>;
  onRequestThumbs: (paths: string[]) => void;
  categoryTinting: boolean;
  gridSize: GridSize;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  thumbResetKey?: string;
  onGridColumnsChange?: (columns: number) => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
  onEntryContextMenu?: (
    event: ReactMouseEvent,
    target: { path: string; isDir: boolean },
  ) => void;
  dropTargetPath?: string | null;
  onStartDragOut?: (paths: string[]) => void;
};

type GridSizing = {
  column: number;
  gap: number;
  rowHeight: number;
  padding: number;
};

const GRID_PRESETS: Record<GridSize, GridSizing> = {
  compact: {
    column: 180,
    gap: 12,
    rowHeight: 210,
    padding: 6,
  },
  large: {
    column: 220,
    gap: 14,
    rowHeight: 252,
    padding: 8,
  },
};

const GRID_META_TRIM = 24;
const GRID_OVERSCAN = 3;
const GRID_OVERSCAN_MIN = 1;
const GRID_OVERSCAN_WARMUP_MS = 140;
const noop = () => {};

export default function FileGrid({
  entries,
  items,
  itemIndexMap,
  loading,
  searchQuery,
  scrollKey,
  initialScrollTop,
  scrollReady,
  scrollRequest,
  smoothScroll,
  selectedPaths,
  onSetSelection,
  onOpenDir,
  onOpenDirNewTab,
  onOpenEntry,
  onSelectItem,
  onClearSelection,
  onScrollTopChange,
  entryMeta,
  onRequestMeta,
  thumbnailsEnabled,
  thumbnails,
  onRequestThumbs,
  categoryTinting,
  gridSize,
  gridShowSize,
  gridShowExtension,
  gridNameEllipsis,
  gridNameHideExtension,
  thumbResetKey,
  onGridColumnsChange,
  onContextMenu,
  onEntryContextMenu,
  dropTargetPath,
  onStartDragOut,
}: FileGridProps) {
  const emptyMessage = useMemo(() => getEmptyMessage(searchQuery), [searchQuery]);
  const viewItems = items;
  const persistScrollTop = useCallback(
    (key: string, scrollTop: number) => {
      onScrollTopChange(key, scrollTop);
    },
    [onScrollTopChange],
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { width: viewportWidth } = useElementSize(viewportRef);
  const layoutReady = viewportWidth > 0;
  const scrolling = useScrollSettled(viewportRef);

  const gridMetaEnabled = gridShowSize || gridShowExtension;
  const gridSizing = useMemo(() => {
    const preset = GRID_PRESETS[gridSize] ?? GRID_PRESETS.compact;
    if (gridMetaEnabled) return preset;
    return {
      ...preset,
      rowHeight: preset.rowHeight - GRID_META_TRIM,
    };
  }, [gridMetaEnabled, gridSize]);
  const gridVars = useMemo(
    () =>
      ({
        "--thumb-column": `${gridSizing.column}px`,
        "--thumb-gap": `${gridSizing.gap}px`,
        "--thumb-row-height": `${gridSizing.rowHeight}px`,
        "--thumb-padding": `${gridSizing.padding}px`,
      }) as CSSProperties,
    [gridSizing],
  );
  const contentWidth = Math.max(0, viewportWidth - gridSizing.padding * 2);
  const columnCount = Math.max(
    1,
    Math.floor((contentWidth + gridSizing.gap) / (gridSizing.column + gridSizing.gap)),
  );
  const rowCount = Math.ceil(viewItems.length / columnCount);
  const rowHeight = gridSizing.rowHeight + gridSizing.gap;
  const lastLayoutRef = useRef({ gridSize, columnCount, rowHeight });

  // When smooth scrolling is disabled, snap wheel input to a single grid row.
  useWheelSnap(viewportRef, smoothScroll ? 0 : rowHeight);

  // Keep the same entries in view when density changes by anchoring the viewport center.
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      lastLayoutRef.current = { gridSize, columnCount, rowHeight };
      return;
    }
    const last = lastLayoutRef.current;
    const gridSizeChanged = last.gridSize !== gridSize;
    if (
      gridSizeChanged &&
      last.rowHeight > 0 &&
      last.columnCount > 0 &&
      viewItems.length > 0
    ) {
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
      const maxAnchorIndex = Math.max(0, viewItems.length - 1);
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
        persistScrollTop(scrollKey, clamped);
      }
    }
    lastLayoutRef.current = { gridSize, columnCount, rowHeight };
  }, [columnCount, gridSize, rowHeight, persistScrollTop, scrollKey, viewItems.length]);

  useEffect(() => {
    if (!onGridColumnsChange) return;
    onGridColumnsChange(columnCount);
  }, [columnCount, onGridColumnsChange]);

  const overscan = useDynamicOverscan({
    resetKey: scrollKey,
    base: GRID_OVERSCAN,
    min: GRID_OVERSCAN_MIN,
    warmupMs: GRID_OVERSCAN_WARMUP_MS,
  });
  const virtual = useVirtualRange(viewportRef, rowCount, rowHeight, overscan);
  const startIndex = virtual.startIndex * columnCount;
  const endIndex = Math.min(viewItems.length, virtual.endIndex * columnCount);
  const visibleItems = viewItems.slice(startIndex, endIndex);
  const hasContent = viewItems.length > 0;
  const contentReady = true;
  const viewAnimate = false;
  const metaPaths = useMemo(() => {
    // Build the meta/thumb request list in one pass to keep allocations low.
    if (visibleItems.length === 0) return [];
    const next: string[] = [];
    for (const item of visibleItems) {
      if (!isEntryItem(item)) continue;
      if (item.entry.isDir) continue;
      next.push(item.entry.path);
    }
    return next;
  }, [visibleItems]);
  const handleCardSelect = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.currentTarget as HTMLElement;
      const path = target.dataset.path;
      const index = Number(target.dataset.index);
      if (!path || Number.isNaN(index)) return;
      onSelectItem(path, index, event);
    },
    [onSelectItem],
  );
  const handleCardOpen = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.currentTarget as HTMLElement;
      const path = target.dataset.path;
      const isDir = target.dataset.isDir === "true";
      if (!path) return;
      if (isDir) {
        onOpenDir(path);
        return;
      }
      onOpenEntry(path);
    },
    [onOpenDir, onOpenEntry],
  );
  const handleCardOpenNewTab = useCallback(
    (event: ReactMouseEvent) => {
      if (!onOpenDirNewTab) return;
      const target = event.currentTarget as HTMLElement;
      const path = target.dataset.path;
      const isDir = target.dataset.isDir === "true";
      if (!path || !isDir) return;
      handleMiddleClick(event, () => onOpenDirNewTab(path));
    },
    [onOpenDirNewTab],
  );
  const handleEntryContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!onEntryContextMenu) return;
      const target = event.currentTarget as HTMLElement;
      const path = target.dataset.path;
      if (!path) return;
      onEntryContextMenu(event, {
        path,
        isDir: target.dataset.isDir === "true",
      });
    },
    [onEntryContextMenu],
  );
  const handleParentContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const { handleScrollTopChange: handleAnchorScroll, getAnchorTop } = useScrollAnchor(
    viewportRef,
    {
      scrollKey,
      items: viewItems,
      itemHeight: rowHeight,
      itemsPerRow: columnCount,
      scrollReady,
      loading,
      getItemPath: (item) => {
        if (item.type === "parent") return item.path;
        if (item.type === "entry") return item.entry.path;
        return null;
      },
      getItemIndex: (path) => itemIndexMap.get(path) ?? null,
      // Persist scroll even while the view is transitioning.
      onScrollTopChange: persistScrollTop,
    },
  );
  const restoreTop = getAnchorTop() ?? initialScrollTop;

  useScrollPosition(viewportRef, {
    scrollKey,
    initialTop: restoreTop,
    onScrollTopChange: handleAnchorScroll,
    restoreReady: scrollReady && !loading && layoutReady,
  });
  useScrollToIndex(viewportRef, {
    itemCount: viewItems.length,
    rowHeight,
    itemsPerRow: columnCount,
    scrollRequest,
  });
  const { selectionBox } = useSelectionDrag(viewportRef, {
    selected: selectedPaths,
    setSelection: onSetSelection,
    clearSelection: onClearSelection,
    itemSelector: "[data-selectable=\"true\"]",
  });
  const dragEnabled = Boolean(onStartDragOut) && !loading;
  useEntryDragOut(viewportRef, {
    selected: selectedPaths,
    onSetSelection,
    onStartDrag: onStartDragOut ?? noop,
    itemSelector: "[data-selectable=\"true\"]",
    enabled: dragEnabled,
  });
  useEntryMetaRequest(loading || scrolling, metaPaths, onRequestMeta);
  const canRequestThumbs = thumbnailsEnabled && !loading && !scrolling;
  useThumbnailRequest(
    loading || scrolling,
    canRequestThumbs,
    metaPaths,
    onRequestThumbs,
    thumbResetKey,
  );

  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${columnCount}, var(--thumb-column))`,
    }),
    [columnCount],
  );
  const showLoadingOverlay = loading && !hasContent;

  return (
    <div
      className="thumb-shell"
      data-category-tint={categoryTinting ? "true" : "false"}
      data-meta-hidden={gridMetaEnabled ? "false" : "true"}
    >
      <div
        className="thumb-viewport"
        ref={viewportRef}
        style={gridVars}
        onContextMenu={(event) => {
          if (!onContextMenu) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest(".thumb-card")) return;
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(event);
        }}
      >
        <div
          className="thumb-content"
          data-ready={contentReady ? "true" : "false"}
          data-animate={viewAnimate ? "true" : "false"}
        >
          <div className="thumb-spacer" style={{ height: `${virtual.offsetTop}px` }} />
          <div className="thumb-grid" style={gridStyle}>
            {visibleItems.map((item, itemIndex) => {
              const index = startIndex + itemIndex;
              if (item.type === "parent") {
                const isDropTarget = dropTargetPath === item.path;
                return (
                  <ParentCard
                    key={item.key}
                    path={item.path}
                    index={index}
                    selected={selectedPaths.has(item.path)}
                    dropTarget={isDropTarget}
                    showMeta={gridMetaEnabled}
                    onSelect={handleCardSelect}
                    onOpen={handleCardOpen}
                    onOpenNewTab={handleCardOpenNewTab}
                    onContextMenu={handleParentContextMenu}
                  />
                );
              }
              const isDropTarget = dropTargetPath === item.entry.path;
              return (
                <EntryCard
                  key={item.key}
                  entry={item.entry}
                  index={index}
                  meta={entryMeta.get(item.entry.path)}
                  thumbUrl={
                    thumbnailsEnabled ? thumbnails.get(item.entry.path) : undefined
                  }
                  showSize={gridShowSize}
                  showExtension={gridShowExtension}
                  nameEllipsis={gridNameEllipsis}
                  hideExtension={gridNameHideExtension}
                  selected={selectedPaths.has(item.entry.path)}
                  dropTarget={isDropTarget}
                  onSelect={handleCardSelect}
                  onOpen={handleCardOpen}
                  onOpenNewTab={handleCardOpenNewTab}
                  onContextMenu={handleEntryContextMenu}
                />
              );
            })}
          </div>
          <div className="thumb-spacer" style={{ height: `${virtual.offsetBottom}px` }} />
          {entries.length === 0 && !loading ? (
            <div className="thumb-empty">
              <EmptyState title={emptyMessage.title} subtitle={emptyMessage.subtitle} />
            </div>
          ) : null}
        </div>
        <SelectionRect box={selectionBox} />
      </div>
      <div
        className="loading-overlay"
        data-visible={showLoadingOverlay ? "true" : "false"}
        data-solid={!hasContent ? "true" : "false"}
      >
        <LoadingIndicator />
      </div>
    </div>
  );
}
