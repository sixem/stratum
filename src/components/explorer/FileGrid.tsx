// Virtualized grid view for file entries.
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useMemo } from "react";
import {
  useCreateEntryPrompt,
  useEntryPresence,
  useScrollToIndex,
} from "@/hooks";
import { getEmptyMessage, handleMiddleClick, normalizePath } from "@/lib";
import type { DropTarget, EntryItem } from "@/lib";
import type { GridNameEllipsis, GridSize, ThumbnailFit } from "@/modules";
import type { EntryMeta, FileEntry, RenameCommitReason, ThumbnailRequest } from "@/types";
import { EmptyState } from "@/components/primitives/EmptyState";
import { LoadingIndicator } from "@/components/primitives/LoadingIndicator";
import { EntryCard, ParentCard } from "./fileGrid/index";
import { ThumbViewport } from "./fileGrid/ThumbViewport";
import { useGridSelection } from "./fileGrid/useGridSelection";
import { useGridSizing } from "./fileGrid/useGridSizing";
import { useGridThumbRequests } from "./fileGrid/useGridThumbRequests";
import { useGridTooltip } from "./fileGrid/useGridTooltip";
import { useGridVirtual } from "./fileGrid/useGridVirtual";

type FileGridProps = {
  currentPath: string;
  entries: FileEntry[];
  items: EntryItem[];
  indexMap?: Map<string, number>;
  loading: boolean;
  searchQuery: string;
  viewKey: string;
  scrollRestoreKey: string;
  scrollRestoreTop: number;
  scrollRequest?: { index: number; nonce: number } | null;
  smoothScroll: boolean;
  pendingDeletePaths: Set<string>;
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
  thumbnailFolders: boolean;
  thumbnailVideos: boolean;
  thumbnailSvgs: boolean;
  categoryTinting: boolean;
  gridSize: GridSize;
  gridAutoColumns: number;
  gridGap: number;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  autoViewportWidth?: number;
  onAutoViewportWidthChange?: (width: number) => void;
  instantResizeKey?: string | number | boolean;
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
  onEntryPreviewPress?: (path: string) => boolean;
  onEntryPreviewRelease?: (path: string) => boolean;
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

const FileGrid = ({
  currentPath,
  entries,
  items,
  indexMap,
  loading,
  searchQuery,
  viewKey,
  scrollRestoreKey,
  scrollRestoreTop,
  scrollRequest,
  smoothScroll,
  pendingDeletePaths,
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
  thumbnailFolders,
  thumbnailVideos,
  thumbnailSvgs,
  categoryTinting,
  gridSize,
  gridAutoColumns,
  gridGap,
  gridShowSize,
  gridShowExtension,
  gridNameEllipsis,
  gridNameHideExtension,
  autoViewportWidth,
  onAutoViewportWidthChange,
  instantResizeKey,
  thumbResetKey,
  presenceEnabled = true,
  onGridColumnsChange,
  onContextMenu,
  onContextMenuDown,
  onEntryContextMenu,
  onEntryContextMenuDown,
  onEntryPreviewPress,
  onEntryPreviewRelease,
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
  const isDeletePending = useCallback(
    (path: string) => {
      const key = normalizePath(path) ?? path.trim();
      return key ? pendingDeletePaths.has(key) : false;
    },
    [pendingDeletePaths],
  );
  const emptyMessage = useMemo(() => getEmptyMessage(searchQuery), [searchQuery]);
  const { items: viewItems } = useEntryPresence({
    items,
    resetKey: viewKey,
    animate: !loading && presenceEnabled,
  });
  const selectionItems = useMemo(
    () =>
      viewItems.map((item) => ({
        path: item.type === "parent" ? item.path : item.entry.path,
        selectable:
          item.type !== "parent" &&
          item.presence !== "removed" &&
          !isDeletePending(item.entry.path),
      })),
    [isDeletePending, viewItems],
  );
  const resolvedIndexMap = useMemo(() => {
    if (indexMap) return indexMap;
    const map = new Map<string, number>();
    items.forEach((item, index) => {
      const key = item.type === "parent" ? item.path : item.entry.path;
      map.set(key, index);
    });
    return map;
  }, [indexMap, items]);
  const entryByPath = useMemo(() => {
    const map = new Map<string, FileEntry>();
    entries.forEach((entry) => {
      map.set(entry.path, entry);
    });
    return map;
  }, [entries]);

  const {
    viewportRef,
    gridVars,
    gridStyle,
    viewportHeight,
    columnCount,
    columnWidth,
    rowCount,
    rowHeight,
    gridMetaEnabled,
    isResizing,
  } = useGridSizing({
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
    viewItemsLength: viewItems.length,
  });

  const { virtual, visibleItems, startIndex } = useGridVirtual({
    viewportRef,
    viewportHeight,
    viewKey,
    columnCount,
    rowCount,
    rowHeight,
    viewItems,
  });

  useScrollToIndex(viewportRef, {
    itemCount: viewItems.length,
    rowHeight,
    itemsPerRow: columnCount,
    scrollRequest,
    scrollKey: viewKey,
  });

  const {
    gridMetaByPath,
    thumbSource,
    folderThumbSource,
    fileIcons,
    interactionActive,
  } =
    useGridThumbRequests({
      viewportRef,
      viewKey,
      visibleItems,
      isResizing,
      entryMeta,
      onRequestMeta,
      thumbnailsEnabled,
      thumbnails,
      onRequestThumbs,
      thumbResetKey,
      thumbnailAppIcons,
      thumbnailFolders,
      thumbnailVideos,
      thumbnailSvgs,
      loading,
    });
  useGridTooltip({
    viewportRef,
    entryByPath,
    entryMeta,
    disabled: interactionActive,
  });

  const { selectionBox } = useGridSelection({
    viewportRef,
    selectedPaths,
    selectionItems,
    columnCount,
    columnWidth,
    rowHeight,
    gridGap,
    onSetSelection,
    onClearSelection,
    onStartDragOut,
    onInternalDrop,
    onInternalHover,
    loading,
  });

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
  const handleParentSelect = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) return;
      onClearSelection();
    },
    [onClearSelection],
  );

  const showCreatePrompt = useCreateEntryPrompt();
  const hasContent = viewItems.length > 0;
  const contentReady = true;
  const viewAnimate = false;
  const showLoadingOverlay = loading && !hasContent;

  return (
    <div
      className="thumb-shell"
      data-category-tint={categoryTinting ? "true" : "false"}
      data-meta-hidden={gridMetaEnabled ? "false" : "true"}
    >
      <ThumbViewport
        viewportRef={viewportRef}
        gridVars={gridVars}
        contentReady={contentReady}
        viewAnimate={viewAnimate}
        selectionBox={selectionBox}
        onContextMenu={onContextMenu}
        onContextMenuDown={onContextMenuDown}
      >
        <div className="thumb-spacer" style={{ height: `${virtual.offsetTop}px` }} />
        <div className="thumb-grid" style={gridStyle}>
          {visibleItems.map((item, itemIndex) => {
            const index = startIndex + itemIndex;
            if (item.type === "parent") {
              const isDropTarget = dropTargetPath === item.path;
              const baseIndex = resolvedIndexMap.get(item.path) ?? index;
              return (
                <ParentCard
                  key={item.key}
                  path={item.path}
                  index={baseIndex}
                  dropTarget={isDropTarget}
                  showMeta={gridMetaEnabled}
                  onSelect={handleParentSelect}
                  onOpen={handleCardOpen}
                  onOpenNewTab={handleCardOpenNewTab}
                  onContextMenu={handleParentContextMenu}
                  onContextMenuDown={handleEntryContextMenuDown}
                />
              );
            }
            const isDropTarget = dropTargetPath === item.entry.path;
            const itemMeta = gridMetaByPath.get(item.entry.path);
            const baseIndex = resolvedIndexMap.get(item.entry.path) ?? index;
            const thumbUrl = thumbnailsEnabled
              ? item.entry.isDir
                ? folderThumbSource.get(item.entry.path)
                : thumbSource.get(item.entry.path)
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
                fileKind={itemMeta?.fileKind ?? "generic"}
                extension={itemMeta?.extension ?? null}
                sizeLabel={itemMeta?.sizeLabel ?? ""}
                thumbUrl={thumbUrl}
                appIconUrl={appIconUrl}
                appIconsEnabled={thumbnailAppIcons}
                disableTooltip={interactionActive}
                showSize={gridShowSize}
                showExtension={gridShowExtension}
                nameEllipsis={gridNameEllipsis}
                hideExtension={gridNameHideExtension}
                selected={selectedPaths.has(item.entry.path)}
                isDeleting={isDeletePending(item.entry.path)}
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
                onPreviewPress={onEntryPreviewPress}
                onPreviewRelease={onEntryPreviewRelease}
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
      </ThumbViewport>
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
