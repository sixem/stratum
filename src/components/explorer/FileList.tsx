// Virtualized list view for file entries.
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
import type { EntryMeta, FileEntry, RenameCommitReason, SortState } from "@/types";
import { EmptyState } from "@/components/primitives/EmptyState";
import { LoadingIndicator } from "@/components/primitives/LoadingIndicator";
import { SelectionRect } from "./SelectionRect";
import { EntryRow, ParentRow } from "./fileList/index";
import { ListHeader } from "./fileList/ListHeader";
import { useListLayout } from "./fileList/useListLayout";
import { useListMeta } from "./fileList/useListMeta";
import { useListSelection } from "./fileList/useListSelection";
import { useListVirtual } from "./fileList/useListVirtual";

type FileListProps = {
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
  sortState: SortState;
  onSortChange: (next: SortState) => void;
  categoryTinting: boolean;
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
  presenceEnabled?: boolean;
  canGoUp?: boolean;
  onGoUp?: () => void;
};

const FileList = ({
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
  sortState,
  onSortChange,
  categoryTinting,
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
  presenceEnabled = true,
  canGoUp,
  onGoUp,
}: FileListProps) => {
  const emptyMessage = useMemo(() => getEmptyMessage(searchQuery), [searchQuery]);
  const { items: rows } = useEntryPresence({
    items,
    resetKey: viewKey,
    animate: !loading && presenceEnabled,
  });
  const selectionItems = useMemo(
    () =>
      rows.map((row) => ({
        path: row.type === "parent" ? row.path : row.entry.path,
        selectable: row.presence !== "removed",
      })),
    [rows],
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

  const { listRef, itemHeight, rowHeight, listVars } = useListLayout({
    smoothScroll,
    scrollRestoreKey,
    scrollRestoreTop,
    loading,
  });

  const { virtual, visibleRows } = useListVirtual({
    listRef,
    viewKey,
    itemHeight,
    rows,
  });

  useScrollToIndex(listRef, {
    itemCount: rows.length,
    rowHeight: itemHeight,
    scrollRequest,
    scrollKey: viewKey,
  });

  const rowMetaByPath = useListMeta({
    listRef,
    viewKey,
    visibleRows,
    entryMeta,
    onRequestMeta,
    loading,
  });

  const { selectionBox } = useListSelection({
    listRef,
    selectedPaths,
    selectionItems,
    itemHeight,
    rowHeight,
    onSetSelection,
    onClearSelection,
    onStartDragOut,
    onInternalDrop,
    onInternalHover,
    loading,
  });

  const handleRowSelect = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.currentTarget as HTMLElement;
      const path = target.dataset.path;
      const index = Number(target.dataset.index);
      if (!path || Number.isNaN(index)) return;
      onSelectItem(path, index, event);
    },
    [onSelectItem],
  );

  const handleRowOpen = useCallback(
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

  const handleRowOpenNewTab = useCallback(
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
  const hasContent = rows.length > 0;
  const contentReady = true;
  const viewAnimate = false;
  const showLoadingOverlay = loading && !hasContent;

  return (
    <div className="file-list">
      <ListHeader sortState={sortState} onSortChange={onSortChange} />
      <div className="list-shell" data-category-tint={categoryTinting ? "true" : "false"}>
        <div
          className="list-body"
          ref={listRef}
          style={listVars}
          onPointerDown={(event) => {
            if (event.button !== 2) return;
            if (!onContextMenuDown) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest(".row")) return;
            event.stopPropagation();
            onContextMenuDown(event);
          }}
          onPointerUp={(event) => {
            if (event.button !== 2) return;
            if (!onContextMenu) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest(".row")) return;
            event.stopPropagation();
            onContextMenu(event);
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
                  const isDropTarget = dropTargetPath === row.path;
                  const baseIndex = resolvedIndexMap.get(row.path) ?? index;
                  return (
                    <ParentRow
                      key={row.key}
                      path={row.path}
                      index={baseIndex}
                      selected={selectedPaths.has(row.path)}
                      dropTarget={isDropTarget}
                      onSelect={handleRowSelect}
                      onOpen={handleRowOpen}
                      onOpenNewTab={handleRowOpenNewTab}
                      onContextMenu={handleParentContextMenu}
                      onContextMenuDown={handleEntryContextMenuDown}
                    />
                  );
                }
                const isDropTarget = dropTargetPath === row.entry.path;
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
                    selected={selectedPaths.has(row.entry.path)}
                    dropTarget={isDropTarget}
                    isRenaming={renameTargetPath === row.entry.path}
                    renameValue={renameValue}
                    onRenameChange={onRenameChange}
                    onRenameCommit={onRenameCommit}
                    onRenameCancel={onRenameCancel}
                    onSelect={handleRowSelect}
                    onOpen={handleRowOpen}
                    onOpenNewTab={handleRowOpenNewTab}
                    onContextMenu={handleEntryContextMenu}
                    onContextMenuDown={handleEntryContextMenuDown}
                    onPreviewPress={onEntryPreviewPress}
                    onPreviewRelease={onEntryPreviewRelease}
                    presence={row.presence}
                  />
                );
              })}
            </div>
            {entries.length === 0 && !loading ? (
              <div className="list-empty">
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
    </div>
  );
};

export default FileList;
