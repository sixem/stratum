// Virtualized list view for file entries.
import type { CSSProperties } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useMemo, useRef } from "react";
import {
  useEntryDragOut,
  useEntryMetaRequest,
  useScrollPosition,
  useScrollToIndex,
  useSelectionDrag,
  useVirtualRange,
  useViewReady,
} from "@/hooks";
import { buildEntryItems, getEmptyMessage, handleMiddleClick, isEntryItem } from "@/lib";
import type { EntryMeta, FileEntry } from "@/types";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";
import { SelectionRect } from "./SelectionRect";
import { EntryRow, ParentRow } from "./fileList/index";

type FileListProps = {
  entries: FileEntry[];
  loading: boolean;
  parentPath: string | null;
  searchQuery: string;
  scrollKey: string;
  initialScrollTop: number;
  scrollRequest?: { index: number; nonce: number } | null;
  selectedPaths: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab?: (path: string) => void;
  onOpenEntry: (path: string) => void;
  onSelectItem: (path: string, index: number, event: ReactMouseEvent) => void;
  onClearSelection: () => void;
  onScrollTopChange: (key: string, scrollTop: number) => void;
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => void;
  blockReveal: boolean;
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
const noop = () => {};

export default function FileList({
  entries,
  loading,
  parentPath,
  searchQuery,
  scrollKey,
  initialScrollTop,
  scrollRequest,
  selectedPaths,
  onSetSelection,
  onOpenDir,
  onOpenDirNewTab,
  onOpenEntry,
  onSelectItem,
  onClearSelection,
  onScrollTopChange,
  entryMeta,
  onRequestMeta,
  blockReveal,
  onContextMenu,
  onEntryContextMenu,
  dropTargetPath,
  onStartDragOut,
}: FileListProps) {
  const emptyMessage = useMemo(() => getEmptyMessage(searchQuery), [searchQuery]);
  const rows = useMemo(() => buildEntryItems(entries, parentPath), [entries, parentPath]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const itemHeight = ROW_HEIGHT + ROW_GAP;
  const virtual = useVirtualRange(listRef, rows.length, itemHeight, OVERSCAN);
  const visibleRows = rows.slice(virtual.startIndex, virtual.endIndex);
  const hasContent = rows.length > 0;
  // Hide stale rows during navigation to avoid fill-in while scrolled.
  const keepVisible = false;
  const showGhost = blockReveal && !loading && hasContent;
  const { ready: viewReady, animate: viewAnimate } = useViewReady(
    loading,
    [rows.length, parentPath, searchQuery, scrollKey],
    keepVisible,
  );
  const contentReady = (keepVisible ? true : viewReady) && !showGhost;
  const metaPaths = useMemo(
    () =>
      visibleRows
        .filter(isEntryItem)
        .filter((row) => !row.entry.isDir)
        .map((row) => row.entry.path),
    [visibleRows],
  );
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

  useScrollPosition(listRef, {
    scrollKey,
    initialTop: initialScrollTop,
    onScrollTopChange,
    restoreReady: !loading && !showGhost,
  });
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
  const dragEnabled = Boolean(onStartDragOut) && !loading && !showGhost;
  useEntryDragOut(listRef, {
    selected: selectedPaths,
    onSetSelection,
    onStartDrag: onStartDragOut ?? noop,
    itemSelector: "[data-selectable=\"true\"]",
    enabled: dragEnabled,
  });
  useEntryMetaRequest(loading, metaPaths, onRequestMeta);

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
          data-hold={loading ? "true" : "false"}
          data-blocked={showGhost ? "true" : "false"}
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
            data-loading={keepVisible ? "true" : "false"}
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
                return (
                  <EntryRow
                    key={row.key}
                    entry={row.entry}
                    index={index}
                    meta={entryMeta.get(row.entry.path)}
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
        <div className="list-ghost" data-visible={showGhost ? "true" : "false"}>
          {Array.from({ length: 12 }, (_, index) => (
            <div className="ghost-row" key={`ghost-row-${index}`}>
              <span className="ghost-bar ghost-name" />
              <span className="ghost-bar ghost-size" />
              <span className="ghost-bar ghost-modified" />
            </div>
          ))}
        </div>
        <div
          className="loading-overlay"
          data-visible={loading ? "true" : "false"}
          data-solid={!hasContent ? "true" : "false"}
        >
          <LoadingIndicator />
        </div>
      </div>
    </div>
  );
}
