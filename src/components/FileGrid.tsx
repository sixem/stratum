// Virtualized grid view for file entries.
import type { CSSProperties } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useElementSize,
  useEntryDragOut,
  useEntryPresence,
  useEntryMetaRequest,
  useDynamicOverscan,
  useScrollRestore,
  useScrollSettled,
  useScrollToIndex,
  useSelectionDrag,
  useThumbnailPause,
  useThumbnailRequest,
  useTypingActivity,
  useWheelSnap,
  useVirtualRange,
  useFileIcons,
  useCreateEntryPrompt,
} from "@/hooks";
import {
  buildEntryTooltip,
  formatBytes,
  getEmptyMessage,
  getExtension,
  getFileKind,
  handleMiddleClick,
} from "@/lib";
import type { FileKind } from "@/lib";
import type { DropTarget, EntryItem } from "@/lib";
import { THUMB_INTERACTION_COOLDOWN_MS, THUMB_TYPING_PAUSE_MS } from "@/constants";
import {
  GRID_AUTO_COLUMNS_MAX,
  GRID_AUTO_COLUMNS_MIN,
} from "@/modules";
import type { GridNameEllipsis, GridSize, ThumbnailFit } from "@/modules";
import type { EntryMeta, FileEntry, RenameCommitReason, ThumbnailRequest } from "@/types";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";
import { SelectionRect } from "./SelectionRect";
import { EntryCard, ParentCard } from "./fileGrid/index";

type FileGridProps = {
  currentPath: string;
  entries: FileEntry[];
  items: EntryItem[];
  loading: boolean;
  searchQuery: string;
  viewKey: string;
  scrollRestoreKey: string;
  scrollRestoreTop: number;
  scrollRequest?: { index: number; nonce: number } | null;
  smoothScroll: boolean;
  compactMode: boolean;
  selectedPaths: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab?: (path: string) => void;
  onOpenEntry: (path: string) => void;
  onSelectItem: (path: string, index: number, event: ReactMouseEvent) => void;
  onClearSelection: () => void;
  renameTargetPath?: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: (reason: RenameCommitReason) => void;
  onRenameCancel: () => void;
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  thumbnailsEnabled: boolean;
  thumbnails: Map<string, string>;
  onRequestThumbs: (requests: ThumbnailRequest[]) => void;
  thumbnailFit: ThumbnailFit;
  thumbnailAppIcons: boolean;
  categoryTinting: boolean;
  gridSize: GridSize;
  gridAutoColumns: number;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  thumbResetKey?: string;
  presenceEnabled?: boolean;
  onGridColumnsChange?: (columns: number) => void;
  onContextMenu?: (event: ReactPointerEvent) => void;
  onContextMenuDown?: (event: ReactPointerEvent) => void;
  onEntryContextMenu?: (
    event: ReactPointerEvent,
    target: { name: string; path: string; isDir: boolean },
  ) => void;
  onEntryContextMenuDown?: (
    event: ReactPointerEvent,
    target: { name: string; path: string; isDir: boolean },
  ) => void;
  dropTargetPath?: string | null;
  onStartDragOut?: (paths: string[]) => void;
  onInternalDrop?: (paths: string[], target: DropTarget | null) => void;
  onInternalHover?: (target: DropTarget | null) => void;
  onCreateFolder: (parentPath: string, name: string) => Promise<unknown> | void;
  onCreateFolderAndGo?: (parentPath: string, name: string) => Promise<unknown> | void;
  onCreateFile: (parentPath: string, name: string) => Promise<unknown> | void;
  canGoUp?: boolean;
  onGoUp?: () => void;
};

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
): GridPreset => {
  const safeColumns = clampAutoColumns(columns);
  if (viewportWidth <= 0) {
    return { ...base };
  }
  const contentWidth = Math.max(0, viewportWidth - base.padding * 2);
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
const GRID_OVERSCAN = 3;
const GRID_OVERSCAN_MIN = 1;
const GRID_OVERSCAN_WARMUP_MS = 140;
const COMPACT_VIEW_INSET = 10;
const AUTO_GRID_RESIZE_DEBOUNCE_MS = 180;
// Pause thumbnail work briefly after key presses to keep input responsive.
const noop = () => {};

type GridDisplayMeta = {
  tooltipText: string;
  fileKind: FileKind;
  extension: string | null;
  sizeLabel: string;
};

const FileGrid = ({
  currentPath,
  entries,
  items,
  loading,
  searchQuery,
  viewKey,
  scrollRestoreKey,
  scrollRestoreTop,
  scrollRequest,
  smoothScroll,
  compactMode,
  selectedPaths,
  onSetSelection,
  onOpenDir,
  onOpenDirNewTab,
  onOpenEntry,
  onSelectItem,
  onClearSelection,
  renameTargetPath,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  entryMeta,
  onRequestMeta,
  thumbnailsEnabled,
  thumbnails,
  onRequestThumbs,
  thumbnailFit,
  thumbnailAppIcons,
  categoryTinting,
  gridSize,
  gridAutoColumns,
  gridShowSize,
  gridShowExtension,
  gridNameEllipsis,
  gridNameHideExtension,
  thumbResetKey,
  presenceEnabled = true,
  onGridColumnsChange,
  onContextMenu,
  onContextMenuDown,
  onEntryContextMenu,
  onEntryContextMenuDown,
  dropTargetPath,
  onStartDragOut,
  onInternalDrop,
  onInternalHover,
  onCreateFolder,
  onCreateFolderAndGo,
  onCreateFile,
  canGoUp,
  onGoUp,
}: FileGridProps) => {
  const emptyMessage = useMemo(() => getEmptyMessage(searchQuery), [searchQuery]);
  const { items: viewItems } = useEntryPresence({
    items,
    resetKey: viewKey,
    animate: !loading && presenceEnabled,
  });
  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item, index) => {
      const key = item.type === "parent" ? item.path : item.entry.path;
      map.set(key, index);
    });
    return map;
  }, [items]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { width: viewportWidth } = useElementSize(viewportRef);
  const [stableViewportWidth, setStableViewportWidth] = useState(viewportWidth);
  const viewportWidthRef = useRef(viewportWidth);
  const resizeDebounceRef = useRef<number | null>(null);
  const scrolling = useScrollSettled(viewportRef);
  const typingActive = useTypingActivity({ resetDelayMs: THUMB_TYPING_PAUSE_MS });
  const interactionActive = scrolling || typingActive;
  const [thumbsSuppressed, setThumbsSuppressed] = useState(false);
  const thumbSnapshotRef = useRef<Map<string, string>>(new Map());
  const lastSuppressedRef = useRef(false);

  useEffect(() => {
    // Hide thumbnail previews briefly during/after interaction to keep scrolling smooth.
    if (interactionActive) {
      setThumbsSuppressed(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setThumbsSuppressed(false);
    }, THUMB_INTERACTION_COOLDOWN_MS);
    return () => window.clearTimeout(timer);
  }, [interactionActive]);

  useEffect(() => {
    // Freeze the current thumbnail map during suppression so loaded thumbs stay visible.
    if (thumbsSuppressed && !lastSuppressedRef.current) {
      thumbSnapshotRef.current = thumbnails;
    } else if (!thumbsSuppressed) {
      thumbSnapshotRef.current = thumbnails;
    }
    lastSuppressedRef.current = thumbsSuppressed;
  }, [thumbsSuppressed, thumbnails]);

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
    setStableViewportWidth(viewportWidthRef.current);
  }, [viewKey]);

  const gridMetaEnabled = gridShowSize || gridShowExtension;
  const layoutViewportWidth = gridSize === "auto" ? stableViewportWidth : viewportWidth;
  const gridSizing = useMemo(() => {
    const basePreset = GRID_PRESETS[gridSize === "auto" ? "normal" : gridSize] ?? GRID_PRESETS.small;
    const preset =
      gridSize === "auto"
        ? buildAutoPreset(basePreset, layoutViewportWidth, gridAutoColumns)
        : basePreset;
    return buildGridSizing(preset, gridMetaEnabled);
  }, [gridAutoColumns, gridMetaEnabled, gridSize, layoutViewportWidth]);
  const gridVars = useMemo(
    () =>
      ({
        "--thumb-column": `${gridSizing.column}px`,
        "--thumb-gap": `${gridSizing.gap}px`,
        "--thumb-row-height": `${gridSizing.rowHeight}px`,
        "--thumb-padding": `${gridSizing.padding}px`,
        "--thumb-icon-height": `${gridSizing.iconHeight}px`,
        "--thumb-meta-height": `${gridSizing.metaHeight}px`,
        "--thumb-fit": thumbnailFit,
        "--thumb-preview-bg": thumbnailFit === "contain" ? "transparent" : "#0f131d",
    }) as CSSProperties,
    [gridSizing, thumbnailFit],
  );
  const contentWidth = Math.max(0, layoutViewportWidth - gridSizing.padding * 2);
  const columnCount =
    gridSize === "auto"
      ? clampAutoColumns(gridAutoColumns)
      : Math.max(
          1,
          Math.floor((contentWidth + gridSizing.gap) / (gridSizing.column + gridSizing.gap)),
        );
  const rowCount = Math.ceil(viewItems.length / columnCount);
  const rowHeight = gridSizing.rowHeight + gridSizing.gap;
  const lastLayoutRef = useRef({ gridSize, columnCount, rowHeight });
  const layoutReady = viewportWidth > 0;

  // When smooth scrolling is disabled, snap wheel input to a single grid row.
  useWheelSnap(viewportRef, smoothScroll ? 0 : rowHeight);
  // Restore the stored scroll offset once the grid has a measurable height.
  useScrollRestore(viewportRef, {
    restoreKey: scrollRestoreKey,
    restoreTop: scrollRestoreTop,
    restoreReady: !loading && layoutReady,
  });

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
      }
    }
    lastLayoutRef.current = { gridSize, columnCount, rowHeight };
  }, [columnCount, gridSize, rowHeight, viewItems.length]);

  useEffect(() => {
    if (!onGridColumnsChange) return;
    onGridColumnsChange(columnCount);
  }, [columnCount, onGridColumnsChange]);

  const overscan = useDynamicOverscan({
    resetKey: viewKey,
    base: GRID_OVERSCAN,
    min: GRID_OVERSCAN_MIN,
    warmupMs: GRID_OVERSCAN_WARMUP_MS,
  });
  const viewInset = compactMode ? COMPACT_VIEW_INSET : 0;
  const virtual = useVirtualRange(
    viewportRef,
    rowCount,
    rowHeight,
    overscan,
    viewInset,
    viewInset,
  );
  const startIndex = virtual.startIndex * columnCount;
  const endIndex = Math.min(viewItems.length, virtual.endIndex * columnCount);
  // Memoize the visible slice so selection updates don't rebuild metadata/thumb lists.
  const visibleItems = useMemo(
    () => viewItems.slice(startIndex, endIndex),
    [endIndex, startIndex, viewItems],
  );
  const hasContent = viewItems.length > 0;
  const contentReady = true;
  const viewAnimate = false;
  const { metaPaths, thumbRequests } = useMemo(() => {
    // Build the meta + thumbnail request lists in one pass to keep allocations low.
    if (visibleItems.length === 0) {
      return { metaPaths: [], thumbRequests: [] };
    }
    const nextMeta: string[] = [];
    const nextThumbs: ThumbnailRequest[] = [];
    for (const item of visibleItems) {
      if (item.type !== "entry") continue;
      if (item.presence === "removed") continue;
      if (item.entry.isDir) continue;
      const path = item.entry.path;
      nextMeta.push(path);
      const meta = entryMeta.get(path);
      // Provide cached size/modified so the backend can hash without extra stats.
      nextThumbs.push({
        path,
        size: meta?.size ?? null,
        modified: meta?.modified ?? null,
      });
    }
    return { metaPaths: nextMeta, thumbRequests: nextThumbs };
  }, [entryMeta, visibleItems]);
  const entryMetaCacheRef = useRef<Map<string, GridDisplayMeta>>(new Map());

  useEffect(() => {
    // Reset cached grid labels on view changes to keep memory bounded.
    entryMetaCacheRef.current.clear();
  }, [viewKey]);

  const gridMetaByPath = useMemo(() => {
    const cache = entryMetaCacheRef.current;
    const next = new Map<string, GridDisplayMeta>();
    visibleItems.forEach((item) => {
      if (item.type !== "entry") return;
      if (item.presence === "removed") return;
      const entry = item.entry;
      const path = entry.path;
      const meta = entryMeta.get(path);
      const cacheKey = `${path}:${meta?.modified ?? "none"}:${meta?.size ?? "none"}`;
      let resolved = cache.get(cacheKey);
      if (!resolved) {
        const extension = entry.isDir ? null : getExtension(entry.name);
        resolved = {
          tooltipText: buildEntryTooltip(entry, meta),
          fileKind: entry.isDir ? "generic" : getFileKind(entry.name),
          extension,
          sizeLabel: entry.isDir ? "Folder" : formatBytes(meta?.size ?? null),
        };
        cache.set(cacheKey, resolved);
      }
      next.set(path, resolved);
    });
    return next;
  }, [entryMeta, visibleItems]);
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
  const handleEntryContextMenuDown = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!onEntryContextMenuDown) return;
      const target = event.currentTarget as HTMLElement;
      const path = target.dataset.path;
      const name = target.dataset.name ?? "";
      if (!path) return;
      onEntryContextMenuDown(event, {
        path,
        name,
        isDir: target.dataset.isDir === "true",
      });
    },
    [onEntryContextMenuDown],
  );
  const handleEntryContextMenu = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!onEntryContextMenu) return;
      const target = event.currentTarget as HTMLElement;
      const path = target.dataset.path;
      const name = target.dataset.name ?? "";
      if (!path) return;
      onEntryContextMenu(event, {
        path,
        name,
        isDir: target.dataset.isDir === "true",
      });
    },
    [onEntryContextMenu],
  );
  const handleParentContextMenu = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useScrollToIndex(viewportRef, {
    itemCount: viewItems.length,
    rowHeight,
    itemsPerRow: columnCount,
    scrollRequest,
    scrollKey: viewKey,
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
    onInternalDrop,
    onInternalHover,
    itemSelector: "[data-selectable=\"true\"]",
    enabled: dragEnabled,
  });
  const showCreatePrompt = useCreateEntryPrompt();
  useEntryMetaRequest(loading || scrolling, metaPaths, onRequestMeta);
  // Pause thumbnail generation while the user is actively interacting.
  useThumbnailPause(interactionActive, thumbnailsEnabled);
  const canRequestThumbs = thumbnailsEnabled && !loading && !interactionActive;
  const thumbSource = thumbsSuppressed ? thumbSnapshotRef.current : thumbnails;
  const { icons: fileIcons, requestIcons: requestFileIcons } =
    useFileIcons(thumbnailAppIcons);
  useThumbnailRequest(
    loading || interactionActive,
    canRequestThumbs,
    thumbRequests,
    onRequestThumbs,
    thumbResetKey,
  );

  const iconRequests = useMemo(() => {
    if (!thumbnailAppIcons || visibleItems.length === 0) {
      return [];
    }
    const requests: string[] = [];
    const seen = new Set<string>();
    for (const item of visibleItems) {
      if (item.type !== "entry") continue;
      if (item.presence === "removed") continue;
      if (item.entry.isDir) continue;
      const extension = getExtension(item.entry.name);
      if (!extension || seen.has(extension)) continue;
      seen.add(extension);
      requests.push(extension);
    }
    return requests;
  }, [thumbnailAppIcons, visibleItems]);

  useEffect(() => {
    if (iconRequests.length === 0) return;
    requestFileIcons(iconRequests);
  }, [iconRequests, requestFileIcons]);

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
        onPointerDown={(event) => {
          if (event.button !== 2) return;
          if (!onContextMenuDown) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest(".thumb-card")) return;
          event.stopPropagation();
          onContextMenuDown(event);
        }}
        onPointerUp={(event) => {
          if (event.button !== 2) return;
          if (!onContextMenu) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest(".thumb-card")) return;
          event.stopPropagation();
          onContextMenu(event);
        }}
        onContextMenu={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest(".thumb-card")) return;
          event.preventDefault();
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
                const baseIndex = indexMap.get(item.path) ?? index;
                return (
                  <ParentCard
                    key={item.key}
                    path={item.path}
                    index={baseIndex}
                    selected={selectedPaths.has(item.path)}
                    dropTarget={isDropTarget}
                    showMeta={gridMetaEnabled}
                    onSelect={handleCardSelect}
                    onOpen={handleCardOpen}
                    onOpenNewTab={handleCardOpenNewTab}
                    onContextMenu={handleParentContextMenu}
                    onContextMenuDown={handleEntryContextMenuDown}
                  />
                );
              }
              const isDropTarget = dropTargetPath === item.entry.path;
              const itemMeta = gridMetaByPath.get(item.entry.path);
              const baseIndex = indexMap.get(item.entry.path) ?? index;
              const thumbUrl = thumbnailsEnabled
                ? thumbSource.get(item.entry.path)
                : undefined;
              const appIconUrl =
                thumbnailAppIcons && itemMeta?.extension
                  ? fileIcons.get(itemMeta.extension)
                  : undefined;
              return (
                <EntryCard
                  key={item.key}
                  entry={item.entry}
                  index={baseIndex}
                  tooltipText={itemMeta?.tooltipText ?? ""}
                  fileKind={itemMeta?.fileKind ?? "generic"}
                  extension={itemMeta?.extension ?? null}
                  sizeLabel={itemMeta?.sizeLabel ?? ""}
                  thumbUrl={thumbUrl}
                  appIconUrl={appIconUrl}
                  appIconsEnabled={thumbnailAppIcons}
                  showSize={gridShowSize}
                  showExtension={gridShowExtension}
                  nameEllipsis={gridNameEllipsis}
                  hideExtension={gridNameHideExtension}
                  selected={selectedPaths.has(item.entry.path)}
                  dropTarget={isDropTarget}
                  isRenaming={renameTargetPath === item.entry.path}
                  renameValue={renameValue}
                  onRenameChange={onRenameChange}
                  onRenameCommit={onRenameCommit}
                  onRenameCancel={onRenameCancel}
                  onSelect={handleCardSelect}
                  onOpen={handleCardOpen}
                  onOpenNewTab={handleCardOpenNewTab}
                  onContextMenu={handleEntryContextMenu}
                  onContextMenuDown={handleEntryContextMenuDown}
                  presence={item.presence}
                />
              );
            })}
          </div>
          <div className="thumb-spacer" style={{ height: `${virtual.offsetBottom}px` }} />
          {entries.length === 0 && !loading ? (
            <div className="thumb-empty">
              <EmptyState
                title={emptyMessage.title}
                subtitle={emptyMessage.subtitle}
                actions={
                  searchQuery.trim()
                    ? undefined
                    : [
                        ...(canGoUp && onGoUp
                          ? [
                              {
                                label: "Go up",
                                onClick: onGoUp,
                              },
                            ]
                          : []),
                        {
                          label: "New folder",
                          onClick: () =>
                            showCreatePrompt({
                              kind: "folder",
                              parentPath: currentPath,
                              onCreate: onCreateFolder,
                              onCreateAndGo: onCreateFolderAndGo,
                            }),
                        },
                        {
                          label: "New file",
                          onClick: () =>
                            showCreatePrompt({
                              kind: "file",
                              parentPath: currentPath,
                              onCreate: onCreateFile,
                            }),
                        },
                      ]
                }
              />
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
};

export default FileGrid;
