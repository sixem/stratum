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
import { getEmptyMessage, handleMiddleClick } from "@/lib";
import type { DropTarget, EntryItem } from "@/lib";
import type { GridNameEllipsis, GridSize, ThumbnailFit } from "@/modules";
import type { EntryMeta, FileEntry, RenameCommitReason, ThumbnailRequest } from "@/types";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";
import { EntryCard, ParentCard } from "./fileGrid/index";
import { ThumbViewport } from "./fileGrid/ThumbViewport";
import { useGridSelection } from "./fileGrid/useGridSelection";
import { useGridSizing } from "./fileGrid/useGridSizing";
import { useGridThumbRequests } from "./fileGrid/useGridThumbRequests";
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
  gridGap: number;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  autoViewportWidth?: number;
  onAutoViewportWidthChange?: (width: number) => void;
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
  gridGap,
  gridShowSize,
  gridShowExtension,
  gridNameEllipsis,
  gridNameHideExtension,
  autoViewportWidth,
  onAutoViewportWidthChange,
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
  const fallbackIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item, index) => {
      const key = item.type === "parent" ? item.path : item.entry.path;
      map.set(key, index);
    });
    return map;
  }, [items]);
  const resolvedIndexMap = indexMap ?? fallbackIndexMap;

  const {
    viewportRef,
    gridVars,
    gridStyle,
    columnCount,
    rowCount,
    rowHeight,
    gridMetaEnabled,
  } = useGridSizing({
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
    viewItemsLength: viewItems.length,
  });

  const { virtual, visibleItems, startIndex } = useGridVirtual({
    viewportRef,
    viewKey,
    columnCount,
    rowCount,
    rowHeight,
    compactMode,
    viewItems,
  });

  useScrollToIndex(viewportRef, {
    itemCount: viewItems.length,
    rowHeight,
    itemsPerRow: columnCount,
    scrollRequest,
    scrollKey: viewKey,
  });

  const { gridMetaByPath, thumbSource, fileIcons } = useGridThumbRequests({
    viewportRef,
    viewKey,
    visibleItems,
    entryMeta,
    onRequestMeta,
    thumbnailsEnabled,
    thumbnails,
    onRequestThumbs,
    thumbResetKey,
    thumbnailAppIcons,
    loading,
  });

  const { selectionBox } = useGridSelection({
    viewportRef,
    selectedPaths,
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
            const baseIndex = resolvedIndexMap.get(item.entry.path) ?? index;
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
