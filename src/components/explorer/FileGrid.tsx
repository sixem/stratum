// Virtualized grid view for file entries.
import { useCallback, useMemo } from "react";
import { shallow } from "zustand/shallow";
import { useEntryPresence, useScrollToIndex } from "@/hooks";
import { useThumbnailScope } from "@/hooks/domain/metadata/useThumbnailScope";
import { useSettingsStore } from "@/modules";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { getDefaultTabGridSize } from "@/modules/tabGridSize";
import { EmptyState } from "@/components/primitives/EmptyState";
import { EntryCard, ParentCard } from "./fileGrid/index";
import { ThumbViewport } from "./fileGrid/ThumbViewport";
import type { FileGridProps } from "./fileGrid/fileGrid.types";
import { useFileGridController } from "./fileGrid/useFileGridController";
import { useGridScrollAnchor } from "./fileGrid/useGridScrollAnchor";
import { useGridSelection } from "./fileGrid/useGridSelection";
import { useGridSizing } from "./fileGrid/useGridSizing";
import { useGridThumbRequests } from "./fileGrid/useGridThumbRequests";
import { useGridTooltip } from "./fileGrid/useGridTooltip";
import { useGridVirtual } from "./fileGrid/useGridVirtual";
import { useGridWheelSize } from "./fileGrid/useGridWheelSize";
import { useCutEntries } from "./fileView/useCutEntries";
import { VIEW_INSET } from "./fileView/constants";

const FileGrid = ({
  view,
  selection,
  navigation,
  rename,
  metadata,
  thumbs,
  grid,
  contextMenu,
  preview,
  dragDrop,
  creation,
}: FileGridProps) => {
  const isCut = useCutEntries();
  const usePaneSession = getPaneSessionStore(grid.pane);
  const defaultTabGridSize = useSettingsStore(getDefaultTabGridSize);
  const [tabId, tabGridSize] = usePaneSession(state => [
    state.activeTabId,
    defaultTabGridSize ? state.tabs.find(tab => tab.id === state.activeTabId)?.gridSize : undefined,
  ] as const, shallow);
  const {
    isDeletePending,
    isTransferPending,
    emptyMessage,
    emptyActions,
    resolvedIndexMap,
    handleCardSelect,
    handleCardOpen,
    handleCardOpenNewTab,
    handleEntryContextMenuDown,
    handleEntryContextMenu,
    handleParentContextMenu,
    handleParentSelect,
  } = useFileGridController({
    view,
    selection,
    navigation,
    contextMenu,
    creation,
  });

  const { items: viewItems } = useEntryPresence({
    items: view.items,
    resetKey: view.viewKey,
    animate: !view.loading && (thumbs.presenceEnabled ?? true),
  });
  const selectionItems = useMemo(
    () =>
      viewItems.map((item) => ({
        path: item.type === "parent" ? item.path : item.entry.path,
        selectable:
          item.type !== "parent" &&
          item.presence !== "removed" &&
          !isDeletePending(item.entry.path) &&
          !isTransferPending(item.entry.path),
      })),
    [isDeletePending, isTransferPending, viewItems],
  );

  const {
    viewportRef,
    gridVars,
    gridStyle,
    viewportHeight,
    layoutReady,
    columnCount,
    columnWidth,
    columnGap,
    rowCount,
    rowHeight,
    contentHeight,
    gridMetaEnabled,
    isResizing,
  } = useGridSizing({
    gridSize: defaultTabGridSize ? tabGridSize ?? defaultTabGridSize : grid.gridSize,
    gridAutoColumns: grid.gridAutoColumns,
    gridGap: grid.gridGap,
    gridShowSize: grid.gridShowSize,
    gridShowExtension: grid.gridShowExtension,
    thumbnailFit: thumbs.thumbnailFit,
    resizeDeferred: grid.resizeDeferred,
    viewKey: view.viewKey,
    scrollRestoreKey: view.scrollRestoreKey,
    scrollRestoreTop: view.scrollRestoreTop,
    loading: view.loading,
    smoothScroll: view.smoothScroll,
    autoViewportWidth: grid.autoViewportWidth,
    onAutoViewportWidthChange: grid.onAutoViewportWidthChange,
    onGridColumnsChange: grid.onGridColumnsChange,
    viewItemsLength: viewItems.length,
  });
  useGridWheelSize(viewportRef, view.viewKey, usePaneSession, tabId);

  // Reposition before the virtual range reads the new scroll offset.
  useGridScrollAnchor({
    viewportRef,
    viewKey: view.viewKey,
    scrollRestoreKey: view.scrollRestoreKey,
    loading: view.loading,
    items: viewItems,
    columnCount,
    rowHeight,
    viewportHeight,
    contentHeight,
  });

  const applyScrollRequest = useScrollToIndex(viewportRef, {
    itemCount: viewItems.length,
    rowHeight: rowHeight - columnGap,
    rowGap: columnGap,
    insetTop: VIEW_INSET,
    itemsPerRow: columnCount,
    scrollRequest: view.scrollRequest,
    scrollKey: view.viewKey,
    ready: !view.loading && layoutReady,
  });

  const { virtual, visibleItems, startIndex } = useGridVirtual({
    viewportRef,
    viewportHeight,
    viewKey: view.viewKey,
    columnCount,
    rowCount,
    rowHeight,
    viewItems,
    applyScrollRequest,
  });

  const requestThumbs = useThumbnailScope(
    grid.pane, view.viewKey, thumbs.thumbnailsEnabled, thumbs.onRequestThumbs,
  );
  const {
    gridMetaByPath,
    thumbSource,
    folderThumbSource,
    fileIcons,
    executableIcons,
    interactionActive,
  } = useGridThumbRequests({
    viewportRef,
    viewKey: view.viewKey,
    visibleItems,
    isResizing,
    entryMeta: metadata.entryMeta,
    onRequestMeta: metadata.onRequestMeta,
    thumbnailsEnabled: thumbs.thumbnailsEnabled,
    thumbnails: thumbs.thumbnails,
    onRequestThumbs: requestThumbs,
    thumbResetKey: thumbs.thumbResetKey,
    thumbnailAppIcons: thumbs.thumbnailAppIcons,
    thumbnailFolders: thumbs.thumbnailFolders,
    thumbnailVideos: thumbs.thumbnailVideos,
    thumbnailSvgs: thumbs.thumbnailSvgs,
    loading: view.loading,
  });
  const handleThumbError = useCallback((path: string, failedUrl: string) => {
    if (!view.loading) requestThumbs([{ path, size: null, modified: null, failedUrl }]);
  }, [requestThumbs, view.loading]);
  useGridTooltip({
    viewportRef,
    entryByPath: view.entryByPath,
    entryMeta: metadata.entryMeta,
    disabled: interactionActive,
  });

  const { selectionBox, dragHandlers } = useGridSelection({
    viewportRef,
    selectedPaths: selection.selectedPaths,
    selectionItems,
    columnCount,
    columnWidth,
    rowHeight,
    columnGap,
    rowGap: grid.gridGap,
    onSetSelection: selection.onSetSelection,
    onClearSelection: selection.onClearSelection,
    onStartDragOut: dragDrop.onStartDragOut,
    loading: view.loading,
  });

  // During reflow, keep the old offset reachable until the new range is measured.
  const scrollHeight = Math.max(contentHeight, virtual.totalHeight);

  return (
    <div
      className="thumb-shell"
      {...dragHandlers}
      inert={view.loading}
      data-category-tint={thumbs.categoryTinting ? "true" : "false"}
      data-meta-hidden={gridMetaEnabled ? "false" : "true"}
    >
      <ThumbViewport
        viewportRef={viewportRef}
        gridVars={gridVars}
        contentHeight={scrollHeight}
        selectionBox={selectionBox}
        onContextMenu={contextMenu.onContextMenu}
        onContextMenuDown={contextMenu.onContextMenuDown}
        emptyState={view.entryByPath.size === 0 && !view.loading ? (
          <div className="thumb-empty">
            <EmptyState
              title={emptyMessage.title}
              subtitle={emptyMessage.subtitle}
              actions={emptyActions}
            />
          </div>
        ) : null}
      >
        <div className="thumb-spacer" style={{ height: `${virtual.offsetTop}px` }} />
        <div className="thumb-grid" style={gridStyle}>
          {visibleItems.map((item, itemIndex) => {
            const index = startIndex + itemIndex;
            if (item.type === "parent") {
              const isDropTarget = dragDrop.dropTargetPath === item.path;
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

            const isDropTarget = dragDrop.dropTargetPath === item.entry.path;
            const itemMeta = gridMetaByPath.get(item.entry.path);
            const baseIndex = resolvedIndexMap.get(item.entry.path) ?? index;
            const folderThumb = item.entry.isDir ? folderThumbSource.get(item.entry.path) : undefined;
            const thumbUrl = thumbs.thumbnailsEnabled
              ? item.entry.isDir
                ? folderThumb?.url
                : thumbSource.get(item.entry.path)
              : undefined;
            const appIconUrl =
              thumbs.thumbnailAppIcons && itemMeta?.extension
                ? fileIcons.get(itemMeta.extension)
                : undefined;

            return (
              <EntryCard
                key={item.key}
                entry={item.entry}
                index={baseIndex}
                fileKind={itemMeta?.fileKind ?? "generic"}
                extension={itemMeta?.extension ?? null}
                sizeLabel={itemMeta ? itemMeta.sizeLabel : ""}
                thumbUrl={thumbUrl}
                thumbPath={item.entry.isDir ? folderThumb?.path : item.entry.path}
                onThumbError={handleThumbError}
                appIconUrl={appIconUrl}
                executableIconUrl={executableIcons.get(item.entry.path)}
                appIconsEnabled={thumbs.thumbnailAppIcons}
                disableTooltip={interactionActive}
                showSize={grid.gridShowSize}
                showExtension={grid.gridShowExtension}
                nameEllipsis={grid.gridNameEllipsis}
                hideExtension={grid.gridNameHideExtension}
                selected={selection.selectedPaths.has(item.entry.path)}
                isDeleting={isDeletePending(item.entry.path)}
                isCut={isCut(item.entry.path)}
                isTransferring={isTransferPending(item.entry.path)}
                dropTarget={isDropTarget}
                isRenaming={rename.renameTargetPath === item.entry.path}
                renameValue={rename.renameValue}
                onRenameChange={rename.onRenameChange}
                onRenameCommit={rename.onRenameCommit}
                onRenameCancel={rename.onRenameCancel}
                onSelect={handleCardSelect}
                onOpen={handleCardOpen}
                onOpenNewTab={handleCardOpenNewTab}
                onContextMenu={handleEntryContextMenu}
                onContextMenuDown={handleEntryContextMenuDown}
                onPreviewPress={preview.onEntryPreviewPress}
                onPreviewRelease={preview.onEntryPreviewRelease}
                presence={item.presence}
              />
            );
          })}
        </div>
      </ThumbViewport>
    </div>
  );
};

export default FileGrid;
