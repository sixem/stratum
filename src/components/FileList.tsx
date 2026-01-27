// Virtualized list view for file entries.
import type { CSSProperties } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useEntryDragOut,
  useEntryPresence,
  useEntryMetaRequest,
  useDynamicOverscan,
  useScrollRestore,
  useScrollSettled,
  useScrollToIndex,
  useSelectionDrag,
  useWheelSnap,
  useVirtualRange,
  useCreateEntryPrompt,
} from "@/hooks";
import {
  buildEntryTooltip,
  formatBytes,
  formatDate,
  getEmptyMessage,
  getFileKind,
  nextSortState,
  handleMiddleClick,
} from "@/lib";
import type { DropTarget, EntryItem, FileKind } from "@/lib";
import type { EntryMeta, FileEntry, RenameCommitReason, SortKey, SortState } from "@/types";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";
import { SelectionRect } from "./SelectionRect";
import { EntryRow, ParentRow } from "./fileList/index";

type FileListProps = {
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
  dropTargetPath?: string | null;
  onStartDragOut?: (paths: string[]) => void;
  onInternalDrop?: (paths: string[], target: DropTarget | null) => void;
  onInternalHover?: (target: DropTarget | null) => void;
  onCreateFolder: (parentPath: string, name: string) => Promise<unknown> | void;
  onCreateFile: (parentPath: string, name: string) => Promise<unknown> | void;
  presenceEnabled?: boolean;
  canGoUp?: boolean;
  onGoUp?: () => void;
};

const ROW_HEIGHT = 48;
const ROW_GAP = 8;
const COMPACT_ROW_HEIGHT = 36;
const COMPACT_ROW_GAP = 6;
const COMPACT_VIEW_INSET = 10;
const OVERSCAN = 10;
const OVERSCAN_MIN = 2;
const OVERSCAN_WARMUP_MS = 140;
const noop = () => {};

type RowDisplayMeta = {
  tooltipText: string;
  fileKind: FileKind;
  sizeLabel: string;
  modifiedLabel: string;
};

export default function FileList({
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
  dropTargetPath,
  onStartDragOut,
  onInternalDrop,
  onInternalHover,
  onCreateFolder,
  onCreateFile,
  presenceEnabled = true,
  canGoUp,
  onGoUp,
}: FileListProps) {
  const emptyMessage = useMemo(() => getEmptyMessage(searchQuery), [searchQuery]);
  const { items: rows } = useEntryPresence({
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

  const listRef = useRef<HTMLDivElement | null>(null);
  // Match virtualization height with compact spacing when enabled.
  const rowHeight = compactMode ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
  const rowGap = compactMode ? COMPACT_ROW_GAP : ROW_GAP;
  const itemHeight = rowHeight + rowGap;
  // When smooth scrolling is disabled, snap wheel input to a single row.
  useWheelSnap(listRef, smoothScroll ? 0 : itemHeight);
  // Restore the stored scroll offset once the list height is ready.
  useScrollRestore(listRef, {
    restoreKey: scrollRestoreKey,
    restoreTop: scrollRestoreTop,
    restoreReady: !loading,
  });
  const scrolling = useScrollSettled(listRef);
  const overscan = useDynamicOverscan({
    resetKey: viewKey,
    base: OVERSCAN,
    min: OVERSCAN_MIN,
    warmupMs: OVERSCAN_WARMUP_MS,
  });
  const viewInset = compactMode ? COMPACT_VIEW_INSET : 0;
  const virtual = useVirtualRange(
    listRef,
    rows.length,
    itemHeight,
    overscan,
    viewInset,
    viewInset,
  );
  // Memoize the visible slice so selection drags don't rebuild row metadata.
  const visibleRows = useMemo(
    () => rows.slice(virtual.startIndex, virtual.endIndex),
    [rows, virtual.endIndex, virtual.startIndex],
  );
  const hasContent = rows.length > 0;
  const contentReady = true;
  const viewAnimate = false;
  // Header buttons reuse the global sort state.
  const handleSortClick = useCallback(
    (key: SortKey) => {
      onSortChange(nextSortState(sortState, key));
    },
    [onSortChange, sortState],
  );
  const metaPaths = useMemo(() => {
    const next: string[] = [];
    visibleRows.forEach((row) => {
      if (row.type !== "entry") return;
      if (row.presence === "removed") return;
      if (row.entry.isDir) return;
      next.push(row.entry.path);
    });
    return next;
  }, [visibleRows]);
  const rowMetaCacheRef = useRef<Map<string, RowDisplayMeta>>(new Map());

  useEffect(() => {
    // Reset cached row labels on view changes to keep memory bounded.
    rowMetaCacheRef.current.clear();
  }, [viewKey]);

  const rowMetaByPath = useMemo(() => {
    const cache = rowMetaCacheRef.current;
    const next = new Map<string, RowDisplayMeta>();
    visibleRows.forEach((row) => {
      if (row.type !== "entry") return;
      if (row.presence === "removed") return;
      const entry = row.entry;
      const path = entry.path;
      const meta = entryMeta.get(path);
      const cacheKey = `${path}:${meta?.modified ?? "none"}:${meta?.size ?? "none"}`;
      let resolved = cache.get(cacheKey);
      if (!resolved) {
        const sizeLabel = entry.isDir ? "-" : formatBytes(meta?.size ?? null);
        const modifiedLabel = entry.isDir
          ? "-"
          : meta?.modified == null
            ? "..."
            : formatDate(meta.modified);
        resolved = {
          tooltipText: buildEntryTooltip(row.entry, meta),
          // File kind drives category tinting for list view dots.
          fileKind: entry.isDir ? "generic" : getFileKind(entry.name),
          sizeLabel,
          modifiedLabel,
        };
        cache.set(cacheKey, resolved);
      }
      next.set(path, resolved);
    });
    return next;
  }, [entryMeta, visibleRows]);
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

  useScrollToIndex(listRef, {
    itemCount: rows.length,
    rowHeight: itemHeight,
    scrollRequest,
    scrollKey: viewKey,
  });
  const { selectionBox } = useSelectionDrag(listRef, {
    selected: selectedPaths,
    setSelection: onSetSelection,
    clearSelection: onClearSelection,
    itemSelector: "[data-selectable=\"true\"]",
  });
  const dragEnabled = Boolean(onStartDragOut) && !loading;
  useEntryDragOut(listRef, {
    selected: selectedPaths,
    onSetSelection,
    onStartDrag: onStartDragOut ?? noop,
    onInternalDrop,
    onInternalHover,
    itemSelector: "[data-selectable=\"true\"]",
    enabled: dragEnabled,
  });
  useEntryMetaRequest(loading || scrolling, metaPaths, onRequestMeta);
  const showCreatePrompt = useCreateEntryPrompt();
  const showLoadingOverlay = loading && !hasContent;

  return (
    <div className="file-list">
      <div className="list-header" role="row" data-selection-ignore="true">
        <button
          type="button"
          className="list-header-button"
          data-sort-active={sortState.key === "name" ? "true" : "false"}
          data-sort-dir={sortState.dir}
          aria-sort={
            sortState.key === "name"
              ? sortState.dir === "asc"
                ? "ascending"
                : "descending"
              : "none"
          }
          onClick={() => handleSortClick("name")}
        >
          Name
        </button>
        <button
          type="button"
          className="list-header-button is-right"
          data-sort-active={sortState.key === "size" ? "true" : "false"}
          data-sort-dir={sortState.dir}
          aria-sort={
            sortState.key === "size"
              ? sortState.dir === "asc"
                ? "ascending"
                : "descending"
              : "none"
          }
          onClick={() => handleSortClick("size")}
        >
          Size
        </button>
        <button
          type="button"
          className="list-header-button is-right"
          data-sort-active={sortState.key === "modified" ? "true" : "false"}
          data-sort-dir={sortState.dir}
          aria-sort={
            sortState.key === "modified"
              ? sortState.dir === "asc"
                ? "ascending"
                : "descending"
              : "none"
          }
          onClick={() => handleSortClick("modified")}
        >
          Modified
        </button>
      </div>
      <div className="list-shell" data-category-tint={categoryTinting ? "true" : "false"}>
        <div
          className="list-body"
          ref={listRef}
          style={
            {
              "--list-row-height": `${rowHeight}px`,
              "--list-row-gap": `${rowGap}px`,
            } as CSSProperties
          }
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
                  const baseIndex = indexMap.get(row.path) ?? index;
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
                const baseIndex = indexMap.get(row.entry.path) ?? index;
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
}
