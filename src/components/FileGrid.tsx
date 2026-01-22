// Virtualized grid view for file entries.
import type { CSSProperties } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  useElementSize,
  useEntryDragOut,
  useEntryMetaRequest,
  useLayoutBusy,
  useScrollPosition,
  useScrollToIndex,
  useSelectionDrag,
  useThumbnailRequest,
  useVirtualRange,
  useViewReady,
} from "@/hooks";
import { buildEntryItems, getEmptyMessage, handleMiddleClick, isEntryItem } from "@/lib";
import type { GridNameEllipsis, GridSize } from "@/modules";
import type { EntryMeta, FileEntry } from "@/types";
import layoutLoader from "../assets/icons/loaders/ring.svg";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";
import { SelectionRect } from "./SelectionRect";
import { EntryCard, ParentCard } from "./fileGrid/index";

type FileGridProps = {
  entries: FileEntry[];
  loading: boolean;
  parentPath: string | null;
  searchQuery: string;
  scrollKey: string;
  initialScrollTop: number;
  scrollRequest?: { index: number; nonce: number } | null;
  selectedPaths: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab?: (path: string) => void;
  onOpenEntry: (path: string) => void;
  onSelectItem: (path: string, index: number, event: ReactMouseEvent) => void;
  onClearSelection: () => void;
  onScrollTopChange: (key: string, scrollTop: number) => void;
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => void;
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
  blockReveal: boolean;
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
const LAYOUT_LOADING_MS = 200;
const LAYOUT_LOADING_THRESHOLD = 500;
const LAYOUT_WIDTH_DELTA = 4;
const noop = () => {};

export default function FileGrid({
  entries,
  loading,
  parentPath,
  searchQuery,
  scrollKey,
  initialScrollTop,
  scrollRequest,
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
  blockReveal,
  onGridColumnsChange,
  onContextMenu,
  onEntryContextMenu,
  dropTargetPath,
  onStartDragOut,
}: FileGridProps) {
  const emptyMessage = useMemo(() => getEmptyMessage(searchQuery), [searchQuery]);
  const items = useMemo(() => buildEntryItems(entries, parentPath), [entries, parentPath]);
  const scrollTopRef = useRef(initialScrollTop);
  const handleScrollTopChange = useCallback(
    (key: string, scrollTop: number) => {
      scrollTopRef.current = scrollTop;
      onScrollTopChange(key, scrollTop);
    },
    [onScrollTopChange],
  );

  useEffect(() => {
    scrollTopRef.current = initialScrollTop;
  }, [initialScrollTop, scrollKey]);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { width: viewportWidth } = useElementSize(viewportRef);
  const layoutBusy = useLayoutBusy({
    width: viewportWidth,
    itemCount: items.length,
    threshold: LAYOUT_LOADING_THRESHOLD,
    widthDelta: LAYOUT_WIDTH_DELTA,
    delayMs: LAYOUT_LOADING_MS,
  });

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
  const rowCount = Math.ceil(items.length / columnCount);
  const rowHeight = gridSizing.rowHeight + gridSizing.gap;
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
    if (
      gridSizeChanged &&
      last.rowHeight > 0 &&
      last.columnCount > 0 &&
      items.length > 0
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
      const maxAnchorIndex = Math.max(0, items.length - 1);
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
        handleScrollTopChange(scrollKey, clamped);
      }
    }
    lastLayoutRef.current = { gridSize, columnCount, rowHeight };
  }, [columnCount, gridSize, rowHeight, items.length, handleScrollTopChange, scrollKey]);

  useEffect(() => {
    if (!onGridColumnsChange) return;
    onGridColumnsChange(columnCount);
  }, [columnCount, onGridColumnsChange]);

  const virtual = useVirtualRange(viewportRef, rowCount, rowHeight, GRID_OVERSCAN);
  const startIndex = virtual.startIndex * columnCount;
  const endIndex = Math.min(items.length, virtual.endIndex * columnCount);
  const visibleItems = items.slice(startIndex, endIndex);
  const hasContent = items.length > 0;
  // Hide stale cards during navigation to avoid fill-in while scrolled.
  const keepVisible = false;
  const { ready: viewReady, animate: viewAnimate } = useViewReady(
    loading,
    [items.length, parentPath, searchQuery, scrollKey],
    keepVisible,
  );
  const showGhost = blockReveal && !loading && hasContent;
  const contentReady = (keepVisible ? true : viewReady) && !showGhost;
  const showLayoutLoader = !loading && layoutBusy;
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

  useScrollPosition(viewportRef, {
    scrollKey,
    initialTop: initialScrollTop,
    onScrollTopChange: handleScrollTopChange,
    restoreReady: !loading && !showGhost,
  });
  useScrollToIndex(viewportRef, {
    itemCount: items.length,
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
  const dragEnabled = Boolean(onStartDragOut) && !loading && !showGhost;
  useEntryDragOut(viewportRef, {
    selected: selectedPaths,
    onSetSelection,
    onStartDrag: onStartDragOut ?? noop,
    itemSelector: "[data-selectable=\"true\"]",
    enabled: dragEnabled,
  });
  useEntryMetaRequest(loading, metaPaths, onRequestMeta);
  const canRequestThumbs = thumbnailsEnabled && !blockReveal;
  useThumbnailRequest(loading, canRequestThumbs, metaPaths, onRequestThumbs, thumbResetKey);

  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${columnCount}, var(--thumb-column))`,
    }),
    [columnCount],
  );
  const ghostStyle = useMemo(
    () => ({
      ...gridVars,
      ...gridStyle,
    }),
    [gridStyle, gridVars],
  );

  return (
    <div
      className="thumb-shell"
      data-layout-busy={layoutBusy ? "true" : "false"}
      data-layout-loader={showLayoutLoader ? "true" : "false"}
      data-hold={loading ? "true" : "false"}
      data-category-tint={categoryTinting ? "true" : "false"}
      data-meta-hidden={gridMetaEnabled ? "false" : "true"}
    >
      <div
        className="thumb-viewport"
        ref={viewportRef}
        style={gridVars}
        data-hold={loading ? "true" : "false"}
        data-blocked={showGhost ? "true" : "false"}
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
          data-loading={keepVisible ? "true" : "false"}
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
          {entries.length === 0 && !loading && !layoutBusy ? (
            <div className="thumb-empty">
              <EmptyState title={emptyMessage.title} subtitle={emptyMessage.subtitle} />
            </div>
          ) : null}
        </div>
        <SelectionRect box={selectionBox} />
        <div className="thumb-ghost" data-visible={showGhost ? "true" : "false"}>
          <div className="thumb-ghost-grid" style={ghostStyle}>
            {Array.from(
              { length: Math.max(columnCount * 3, 12) },
              (_, index) => (
                <div className="thumb-ghost-card" key={`ghost-card-${index}`}>
                  <div className="thumb-ghost-icon" />
                  <div className="thumb-ghost-meta">
                    <span className="ghost-bar ghost-name" />
                    {gridMetaEnabled ? <span className="ghost-bar ghost-info" /> : null}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
      <div className="thumb-layout-loading" aria-live="polite">
        <img src={layoutLoader} alt="Updating layout" />
      </div>
      <div
        className="loading-overlay"
        data-visible={loading ? "true" : "false"}
        data-solid={!hasContent ? "true" : "false"}
      >
        <LoadingIndicator />
      </div>
    </div>
  );
}
