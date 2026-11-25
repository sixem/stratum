// Virtualized list view for file entries.
import { useMemo } from "react";
import { useEntryPresence, useScrollToIndex } from "@/hooks";
import { useSettingsStore } from "@/modules";
import { EmptyState } from "@/components/primitives/EmptyState";
import { SelectionRect } from "./SelectionRect";
import { EntryRow, ParentRow } from "./fileList/index";
import { ListHeader } from "./fileList/ListHeader";
import type { FileListProps } from "./fileList/fileList.types";
import { useFileListController } from "./fileList/useFileListController";
import { useListLayout } from "./fileList/useListLayout";
import { useListMeta } from "./fileList/useListMeta";
import { useListSelection } from "./fileList/useListSelection";
import { useListVirtual } from "./fileList/useListVirtual";

import { useCutEntries } from "./fileView/useCutEntries";
import { VIEW_INSET } from "./fileView/constants";

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
  const isCut = useCutEntries();
  const density = useSettingsStore((state) => state.listDensity);
  const showSize = useSettingsStore((state) => state.listShowSize);
  const showModified = useSettingsStore((state) => state.listShowModified);
  const {
    isDeletePending,
    isTransferPending,
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
        selectable: row.presence !== "removed",
      })),
    [rows],
  );

  const { listRef, itemHeight, rowHeight, listVars } = useListLayout({
    density,
    smoothScroll: view.smoothScroll,
    scrollRestoreKey: view.scrollRestoreKey,
    scrollRestoreTop: view.scrollRestoreTop,
    loading: view.loading,
  });

  const applyScrollRequest = useScrollToIndex(listRef, {
    itemCount: rows.length,
    rowHeight,
    rowGap: itemHeight - rowHeight,
    insetTop: VIEW_INSET,
    scrollRequest: view.scrollRequest,
    scrollKey: view.viewKey,
    ready: !view.loading,
  });

  const { virtual, visibleRows } = useListVirtual({
    listRef,
    viewKey: view.viewKey,
    itemHeight,
    rows,
    applyScrollRequest,
  });
  // The full scroll area must exist on the first layout, before measuring the visible range.
  const contentHeight = rows.length * itemHeight + VIEW_INSET * 2;

  const rowMetaByPath = useListMeta({
    listRef,
    viewKey: view.viewKey,
    visibleRows,
    entryMeta: metadata.entryMeta,
    onRequestMeta: metadata.onRequestMeta,
    loading: view.loading,
  });

  const { selectionBox, dragHandlers } = useListSelection({
    listRef,
    selectedPaths: selection.selectedPaths,
    selectionItems,
    canSelectPath: (path) => !view.entryByPath.has(path) || (!isDeletePending(path) && !isTransferPending(path)),
    itemHeight,
    rowHeight,
    onSetSelection: selection.onSetSelection,
    onClearSelection: selection.onClearSelection,
    onStartDragOut: dragDrop.onStartDragOut,
    loading: view.loading,
  });
  const contentReady = true;
  const viewAnimate = false;

  return (
    <div
      className="file-list"
      data-tab-content="list"
      data-density={density}
      data-show-size={showSize}
      data-show-modified={showModified}
      inert={view.loading}
      {...dragHandlers}
      onPointerDown={(event) => {
        if (event.button !== 2 || !contextMenu.onContextMenuDown) return;
        if ((event.target as Element).closest(".row")) return;
        event.stopPropagation();
        contextMenu.onContextMenuDown(event);
      }}
      onPointerUp={(event) => {
        if (event.button !== 2 || !contextMenu.onContextMenu) return;
        if ((event.target as Element).closest(".row")) return;
        event.stopPropagation();
        contextMenu.onContextMenu(event);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ListHeader
        sortState={list.sortState}
        onSortChange={list.onSortChange}
        showSize={showSize}
        showModified={showModified}
      />
      <div className="list-shell" data-category-tint={list.categoryTinting ? "true" : "false"}>
        <div className="list-body" ref={listRef} style={listVars}>
          <div
            className="list-content"
            data-ready={contentReady ? "true" : "false"}
            data-animate={viewAnimate ? "true" : "false"}
          >
            <div className="list-spacer" style={{ height: contentHeight }} />
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
                      showSize={showSize}
                      showModified={showModified}
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
                    sizeLabel={rowMeta ? rowMeta.sizeLabel : ""}
                    modifiedLabel={rowMeta ? rowMeta.modifiedLabel : ""}
                    showSize={showSize}
                    showModified={showModified}
                    nameEllipsis={list.nameEllipsis}
                    hideExtension={list.hideExtension}
                    selected={selection.selectedPaths.has(row.entry.path)}
                    isDeleting={isDeletePending(row.entry.path)}
                    isCut={isCut(row.entry.path)}
                    isTransferring={isTransferPending(row.entry.path)}
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
            {view.entryByPath.size === 0 && !view.loading ? (
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
      </div>
    </div>
  );
};

export default FileList;
