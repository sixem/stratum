// Virtualized list view for file entries.
import type { CSSProperties } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useEntryDragOut,
  useEntryMetaRequest,
  useDynamicOverscan,
  useScrollRestore,
  useScrollSettled,
  useScrollToIndex,
  useSelectionDrag,
  useWheelSnap,
  useVirtualRange,
} from "@/hooks";
import {
  buildEntryTooltip,
  formatBytes,
  formatDate,
  getEmptyMessage,
  handleMiddleClick,
  isEntryItem,
} from "@/lib";
import type { EntryItem } from "@/lib";
import type { EntryMeta, FileEntry } from "@/types";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";
import { SelectionRect } from "./SelectionRect";
import { EntryRow, ParentRow } from "./fileList/index";

type FileListProps = {
  entries: FileEntry[];
  items: EntryItem[];
  loading: boolean;
  searchQuery: string;
  viewKey: string;
  scrollRestoreKey: string;
  scrollRestoreTop: number;
  scrollRequest?: { index: number; nonce: number } | null;
  smoothScroll: boolean;
  selectedPaths: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab?: (path: string) => void;
  onOpenEntry: (path: string) => void;
  onSelectItem: (path: string, index: number, event: ReactMouseEvent) => void;
  onClearSelection: () => void;
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  onContextMenu?: (event: ReactMouseEvent) => void;
  onEntryContextMenu?: (
    event: ReactMouseEvent,
    target: { path: string; isDir: boolean },
  ) => void;
  dropTargetPath?: string | null;
  onStartDragOut?: (paths: string[]) => void;
};

const ROW_HEIGHT = 48;
const ROW_GAP = 8;
const OVERSCAN = 10;
const OVERSCAN_MIN = 2;
const OVERSCAN_WARMUP_MS = 140;
const noop = () => {};

type RowDisplayMeta = {
  tooltipText: string;
  sizeLabel: string;
  modifiedLabel: string;
};

export default function FileList({
  entries,
  items,
  loading,
  searchQuery,
  viewKey,
  scrollRestoreKey,
  scrollRestoreTop,
  scrollRequest,
  smoothScroll,
  selectedPaths,
  onSetSelection,
  onOpenDir,
  onOpenDirNewTab,
  onOpenEntry,
  onSelectItem,
  onClearSelection,
  entryMeta,
  onRequestMeta,
  onContextMenu,
  onEntryContextMenu,
  dropTargetPath,
  onStartDragOut,
}: FileListProps) {
  const emptyMessage = useMemo(() => getEmptyMessage(searchQuery), [searchQuery]);
  const rows = items;

  const listRef = useRef<HTMLDivElement | null>(null);
  const itemHeight = ROW_HEIGHT + ROW_GAP;
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
  const virtual = useVirtualRange(listRef, rows.length, itemHeight, overscan);
  const visibleRows = rows.slice(virtual.startIndex, virtual.endIndex);
  const hasContent = rows.length > 0;
  const contentReady = true;
  const viewAnimate = false;
  const metaPaths = useMemo(
    () =>
      visibleRows
        .filter(isEntryItem)
        .filter((row) => !row.entry.isDir)
        .map((row) => row.entry.path),
    [visibleRows],
  );
  const rowMetaCacheRef = useRef<Map<string, RowDisplayMeta>>(new Map());

  useEffect(() => {
    // Reset cached row labels on view changes to keep memory bounded.
    rowMetaCacheRef.current.clear();
  }, [viewKey]);

  const rowMetaByPath = useMemo(() => {
    const cache = rowMetaCacheRef.current;
    const next = new Map<string, RowDisplayMeta>();
    visibleRows.forEach((row) => {
      if (!isEntryItem(row)) return;
      const path = row.entry.path;
      const meta = entryMeta.get(path);
      const cacheKey = `${path}:${meta?.modified ?? "none"}:${meta?.size ?? "none"}`;
      let resolved = cache.get(cacheKey);
      if (!resolved) {
        const sizeLabel = row.entry.isDir ? "-" : formatBytes(meta?.size ?? null);
        const modifiedLabel = row.entry.isDir
          ? "-"
          : meta?.modified == null
            ? "..."
            : formatDate(meta.modified);
        resolved = {
          tooltipText: buildEntryTooltip(row.entry, meta),
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

  useScrollToIndex(listRef, {
    itemCount: rows.length,
    rowHeight: itemHeight,
    scrollRequest,
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
    itemSelector: "[data-selectable=\"true\"]",
    enabled: dragEnabled,
  });
  useEntryMetaRequest(loading || scrolling, metaPaths, onRequestMeta);
  const showLoadingOverlay = loading && !hasContent;

  return (
    <div className="file-list">
      <div className="list-header">
        <span>Name</span>
        <span>Size</span>
        <span>Modified</span>
      </div>
      <div className="list-shell">
        <div
          className="list-body"
          ref={listRef}
          style={
            {
              "--list-row-height": `${ROW_HEIGHT}px`,
              "--list-row-gap": `${ROW_GAP}px`,
            } as CSSProperties
          }
          onContextMenu={(event) => {
            if (!onContextMenu) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest(".row")) return;
            event.preventDefault();
            event.stopPropagation();
            onContextMenu(event);
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
                  return (
                    <ParentRow
                      key={row.key}
                      path={row.path}
                      index={index}
                      selected={selectedPaths.has(row.path)}
                      dropTarget={isDropTarget}
                      onSelect={handleRowSelect}
                      onOpen={handleRowOpen}
                      onOpenNewTab={handleRowOpenNewTab}
                      onContextMenu={handleParentContextMenu}
                    />
                  );
                }
                const isDropTarget = dropTargetPath === row.entry.path;
                const rowMeta = rowMetaByPath.get(row.entry.path);
                return (
                  <EntryRow
                    key={row.key}
                    entry={row.entry}
                    index={index}
                    tooltipText={rowMeta?.tooltipText ?? ""}
                    sizeLabel={rowMeta?.sizeLabel ?? ""}
                    modifiedLabel={rowMeta?.modifiedLabel ?? ""}
                    selected={selectedPaths.has(row.entry.path)}
                    dropTarget={isDropTarget}
                    onSelect={handleRowSelect}
                    onOpen={handleRowOpen}
                    onOpenNewTab={handleRowOpenNewTab}
                    onContextMenu={handleEntryContextMenu}
                  />
                );
              })}
            </div>
            {entries.length === 0 && !loading ? (
              <div className="list-empty">
                <EmptyState title={emptyMessage.title} subtitle={emptyMessage.subtitle} />
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
