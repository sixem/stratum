// Virtualized grid view for file entries.
import { useMemo } from "react";
import { useEntryPresence, useScrollToIndex } from "@/hooks";
import { EmptyState } from "@/components/primitives/EmptyState";
import { LoadingIndicator } from "@/components/primitives/LoadingIndicator";
import { EntryCard, ParentCard } from "./fileGrid/index";
import { ThumbViewport } from "./fileGrid/ThumbViewport";
import type { FileGridProps } from "./fileGrid/fileGrid.types";
import { useFileGridController } from "./fileGrid/useFileGridController";
import { useGridSelection } from "./fileGrid/useGridSelection";
import { useGridSizing } from "./fileGrid/useGridSizing";
import { useGridThumbRequests } from "./fileGrid/useGridThumbRequests";
import { useGridTooltip } from "./fileGrid/useGridTooltip";
import { useGridVirtual } from "./fileGrid/useGridVirtual";

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
  const {
    isDeletePending,
    emptyMessage,
    emptyActions,
    resolvedIndexMap,
    entryByPath,
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
          !isDeletePending(item.entry.path),
      })),
    [isDeletePending, viewItems],
  );

  const {
    viewportRef,
    gridVars,
    gridStyle,
    viewportHeight,
    columnCount,
    columnWidth,
    columnGap,
    rowCount,
    rowHeight,
    gridMetaEnabled,
    isResizing,
  } = useGridSizing({
    gridSize: grid.gridSize,
    gridAutoColumns: grid.gridAutoColumns,
    gridGap: grid.gridGap,
    gridShowSize: grid.gridShowSize,
    gridShowExtension: grid.gridShowExtension,
    thumbnailFit: thumbs.thumbnailFit,
    instantResizeKey: grid.instantResizeKey,
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

  const { virtual, visibleItems, startIndex } = useGridVirtual({
    viewportRef,
    viewportHeight,
    viewKey: view.viewKey,
    columnCount,
    rowCount,
    rowHeight,
    viewItems,
  });

  useScrollToIndex(viewportRef, {
    itemCount: viewItems.length,
    rowHeight,
    itemsPerRow: columnCount,
    scrollRequest: view.scrollRequest,
    scrollKey: view.viewKey,
  });

  const {
    gridMetaByPath,
    thumbSource,
    folderThumbSource,
    fileIcons,
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
    onRequestThumbs: thumbs.onRequestThumbs,
    thumbResetKey: thumbs.thumbResetKey,
    thumbnailAppIcons: thumbs.thumbnailAppIcons,
    thumbnailFolders: thumbs.thumbnailFolders,
    thumbnailVideos: thumbs.thumbnailVideos,
    thumbnailSvgs: thumbs.thumbnailSvgs,
    loading: view.loading,
  });
  useGridTooltip({
    viewportRef,
    entryByPath,
    entryMeta: metadata.entryMeta,
    disabled: interactionActive,
  });

  const { selectionBox } = useGridSelection({
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
    onInternalDrop: dragDrop.onInternalDrop,
    onInternalHover: dragDrop.onInternalHover,
    loading: view.loading,
  });

  const hasContent = viewItems.length > 0;
  const contentReady = true;
  const viewAnimate = false;
  const showLoadingOverlay = view.loading && !hasContent;

  return (
    <div
      className="thumb-shell"
      data-category-tint={thumbs.categoryTinting ? "true" : "false"}
      data-meta-hidden={gridMetaEnabled ? "false" : "true"}
    >
      <ThumbViewport
        viewportRef={viewportRef}
        gridVars={gridVars}
        contentReady={contentReady}
        viewAnimate={viewAnimate}
        selectionBox={selectionBox}
        onContextMenu={contextMenu.onContextMenu}
        onContextMenuDown={contextMenu.onContextMenuDown}
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
            const thumbUrl = thumbs.thumbnailsEnabled
              ? item.entry.isDir
                ? folderThumbSource.get(item.entry.path)
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
                sizeLabel={itemMeta?.sizeLabel ?? ""}
                thumbUrl={thumbUrl}
                appIconUrl={appIconUrl}
                appIconsEnabled={thumbs.thumbnailAppIcons}
                disableTooltip={interactionActive}
                showSize={grid.gridShowSize}
                showExtension={grid.gridShowExtension}
                nameEllipsis={grid.gridNameEllipsis}
                hideExtension={grid.gridNameHideExtension}
                selected={selection.selectedPaths.has(item.entry.path)}
                isDeleting={isDeletePending(item.entry.path)}
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
        <div className="thumb-spacer" style={{ height: `${virtual.offsetBottom}px` }} />
        {view.entries.length === 0 && !view.loading ? (
          <div className="thumb-empty">
            <EmptyState
              title={emptyMessage.title}
              subtitle={emptyMessage.subtitle}
              actions={emptyActions}
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
