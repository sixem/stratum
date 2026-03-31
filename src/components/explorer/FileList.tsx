// Virtualized list view for file entries.
import { useMemo } from "react";
import { useEntryPresence, useScrollToIndex } from "@/hooks";
import { EmptyState } from "@/components/primitives/EmptyState";
import { LoadingIndicator } from "@/components/primitives/LoadingIndicator";
import { SelectionRect } from "./SelectionRect";
import { EntryRow, ParentRow } from "./fileList/index";
import { ListHeader } from "./fileList/ListHeader";
import type { FileListProps } from "./fileList/fileList.types";
import { useFileListController } from "./fileList/useFileListController";
import { useListLayout } from "./fileList/useListLayout";
import { useListMeta } from "./fileList/useListMeta";
import { useListSelection } from "./fileList/useListSelection";
import { useListVirtual } from "./fileList/useListVirtual";

const FileList = ({
  view,
  selection,
  navigation,
  rename,
  metadata,
  list,
  contextMenu,
  preview,
  dragDrop,
  creation,
}: FileListProps) => {
  const {
    isDeletePending,
    emptyMessage,
    emptyActions,
    resolvedIndexMap,
    handleRowSelect,
    handleRowOpen,
    handleRowOpenNewTab,
    handleEntryContextMenuDown,
    handleEntryContextMenu,
    handleParentContextMenu,
  } = useFileListController({
    view,
    selection,
    navigation,
    contextMenu,
    creation,
  });

  const { items: rows } = useEntryPresence({
    items: view.items,
    resetKey: view.viewKey,
    animate: !view.loading && (list.presenceEnabled ?? true),
  });
  const selectionItems = useMemo(
    () =>
      rows.map((row) => ({
        path: row.type === "parent" ? row.path : row.entry.path,
        selectable:
          row.presence !== "removed" &&
          (row.type === "parent" || !isDeletePending(row.entry.path)),
      })),
    [isDeletePending, rows],
  );

  const { listRef, itemHeight, rowHeight, listVars } = useListLayout({
    smoothScroll: view.smoothScroll,
    scrollRestoreKey: view.scrollRestoreKey,
    scrollRestoreTop: view.scrollRestoreTop,
    loading: view.loading,
  });

  const { virtual, visibleRows } = useListVirtual({
    listRef,
    viewKey: view.viewKey,
    itemHeight,
    rows,
  });

  useScrollToIndex(listRef, {
    itemCount: rows.length,
    rowHeight: itemHeight,
    scrollRequest: view.scrollRequest,
    scrollKey: view.viewKey,
  });

  const rowMetaByPath = useListMeta({
    listRef,
    viewKey: view.viewKey,
    visibleRows,
    entryMeta: metadata.entryMeta,
    onRequestMeta: metadata.onRequestMeta,
    loading: view.loading,
  });

  const { selectionBox } = useListSelection({
    listRef,
    selectedPaths: selection.selectedPaths,
    selectionItems,
    itemHeight,
    rowHeight,
    onSetSelection: selection.onSetSelection,
    onClearSelection: selection.onClearSelection,
    onStartDragOut: dragDrop.onStartDragOut,
    onInternalDrop: dragDrop.onInternalDrop,
    onInternalHover: dragDrop.onInternalHover,
    loading: view.loading,
  });
  const hasContent = rows.length > 0;
  const contentReady = true;
  const viewAnimate = false;
  const showLoadingOverlay = view.loading && !hasContent;

  return (
    <div className="file-list">
      <ListHeader sortState={list.sortState} onSortChange={list.onSortChange} />
      <div className="list-shell" data-category-tint={list.categoryTinting ? "true" : "false"}>
        <div
          className="list-body"
          ref={listRef}
          style={listVars}
          onPointerDown={(event) => {
            if (event.button !== 2) return;
            if (!contextMenu.onContextMenuDown) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest(".row")) return;
            event.stopPropagation();
            contextMenu.onContextMenuDown(event);
          }}
          onPointerUp={(event) => {
            if (event.button !== 2) return;
            if (!contextMenu.onContextMenu) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest(".row")) return;
            event.stopPropagation();
            contextMenu.onContextMenu(event);
          }}
          onContextMenu={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".row")) return;
            event.preventDefault();
          }}
        >
          <div
            className="list-content"
            data-ready={contentReady ? "true" : "false"}
            data-animate={viewAnimate ? "true" : "false"}
          >
            <div className="list-spacer" style={{ height: `${virtual.totalHeight}px` }} />
            <div
              className="list-virtual"
              style={{ transform: `translate3d(0, ${virtual.offsetTop}px, 0)` }}
            >
              {visibleRows.map((row, rowIndex) => {
                const index = virtual.startIndex + rowIndex;
                if (row.type === "parent") {
                  const isDropTarget = dragDrop.dropTargetPath === row.path;
                  const baseIndex = resolvedIndexMap.get(row.path) ?? index;
                  return (
                    <ParentRow
                      key={row.key}
                      path={row.path}
                      index={baseIndex}
                      selected={selection.selectedPaths.has(row.path)}
                      dropTarget={isDropTarget}
                      onSelect={handleRowSelect}
                      onOpen={handleRowOpen}
                      onOpenNewTab={handleRowOpenNewTab}
                      onContextMenu={handleParentContextMenu}
                      onContextMenuDown={handleEntryContextMenuDown}
                    />
                  );
                }
                const isDropTarget = dragDrop.dropTargetPath === row.entry.path;
                const rowMeta = rowMetaByPath.get(row.entry.path);
                const baseIndex = resolvedIndexMap.get(row.entry.path) ?? index;
                return (
                  <EntryRow
                    key={row.key}
                    entry={row.entry}
                    index={baseIndex}
                    tooltipText={rowMeta?.tooltipText ?? ""}
                    fileKind={rowMeta?.fileKind ?? "generic"}
                    sizeLabel={rowMeta?.sizeLabel ?? ""}
                    modifiedLabel={rowMeta?.modifiedLabel ?? ""}
                    nameEllipsis={list.nameEllipsis}
                    hideExtension={list.hideExtension}
                    selected={selection.selectedPaths.has(row.entry.path)}
                    isDeleting={isDeletePending(row.entry.path)}
                    dropTarget={isDropTarget}
                    isRenaming={rename.renameTargetPath === row.entry.path}
                    renameValue={rename.renameValue}
                    onRenameChange={rename.onRenameChange}
                    onRenameCommit={rename.onRenameCommit}
                    onRenameCancel={rename.onRenameCancel}
                    onSelect={handleRowSelect}
                    onOpen={handleRowOpen}
                    onOpenNewTab={handleRowOpenNewTab}
                    onContextMenu={handleEntryContextMenu}
                    onContextMenuDown={handleEntryContextMenuDown}
                    onPreviewPress={preview.onEntryPreviewPress}
                    onPreviewRelease={preview.onEntryPreviewRelease}
                    presence={row.presence}
                  />
                );
              })}
            </div>
            {view.entries.length === 0 && !view.loading ? (
              <div className="list-empty">
                <EmptyState
                  title={emptyMessage.title}
                  subtitle={emptyMessage.subtitle}
                  actions={emptyActions}
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
    </div>
  );
};

export default FileList;
