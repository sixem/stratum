// Switches between list and grid file views.
import { Suspense, lazy } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { GridNameEllipsis, GridSize, ThumbnailFit } from "@/modules";
import type { DropTarget, EntryItem } from "@/lib";
import type {
  EntryMeta,
  FileEntry,
  RenameCommitReason,
  SortState,
  ThumbnailRequest,
  ViewMode,
} from "@/types";
import { LoadingIndicator } from "./LoadingIndicator";
import { PerfProfiler } from "./PerfProfiler";
import { StartLander } from "./StartLander";

const FileList = lazy(() => import("./FileList"));
const FileGrid = lazy(() => import("./FileGrid"));

type FileViewProps = {
  viewMode: ViewMode;
  entries: FileEntry[];
  items: EntryItem[];
  loading: boolean;
  showLander: boolean;
  recentJumps: string[];
  onOpenRecent: (path: string) => void;
  searchQuery: string;
  viewKey: string;
  scrollRestoreKey: string;
  scrollRestoreTop: number;
  scrollRequest?: { index: number; nonce: number } | null;
  smoothScroll: boolean;
  compactMode: boolean;
  sortState: SortState;
  onSortChange: (next: SortState) => void;
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
  categoryTinting: boolean;
  gridSize: GridSize;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  thumbResetKey?: string;
  presenceEnabled?: boolean;
  onGridColumnsChange?: (columns: number) => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
  onEntryContextMenu?: (
    event: ReactMouseEvent,
    target: { name: string; path: string; isDir: boolean },
  ) => void;
  dropTargetPath?: string | null;
  onStartDragOut?: (paths: string[]) => void;
  onInternalDrop?: (paths: string[], target: DropTarget | null) => void;
  onInternalHover?: (target: DropTarget | null) => void;
};

export function FileView({
  viewMode,
  showLander,
  recentJumps,
  onOpenRecent,
  thumbnailsEnabled,
  thumbnails,
  onRequestThumbs,
  thumbnailFit,
  categoryTinting,
  gridSize,
  gridShowSize,
  gridShowExtension,
  gridNameEllipsis,
  gridNameHideExtension,
  thumbResetKey,
  presenceEnabled = true,
  onGridColumnsChange,
  dropTargetPath,
  onStartDragOut,
  onInternalDrop,
  onInternalHover,
  onEntryContextMenu,
  smoothScroll,
  compactMode,
  sortState,
  onSortChange,
  ...viewProps
}: FileViewProps) {
  // Keep the heavy views lazy-loaded but render-driven.
  if (showLander) {
    return <StartLander recentJumps={recentJumps} onOpenRecent={onOpenRecent} />;
  }
  return (
    <Suspense
      fallback={
        <div className="loading-splash">
          <LoadingIndicator />
        </div>
      }
    >
      {viewMode === "thumbs" ? (
        <PerfProfiler id="file-grid">
          <FileGrid
            {...viewProps}
            smoothScroll={smoothScroll}
            compactMode={compactMode}
            thumbnailsEnabled={thumbnailsEnabled}
            thumbnails={thumbnails}
            onRequestThumbs={onRequestThumbs}
            thumbnailFit={thumbnailFit}
            categoryTinting={categoryTinting}
            gridSize={gridSize}
            gridShowSize={gridShowSize}
            gridShowExtension={gridShowExtension}
            gridNameEllipsis={gridNameEllipsis}
            gridNameHideExtension={gridNameHideExtension}
            thumbResetKey={thumbResetKey}
            presenceEnabled={presenceEnabled}
            onGridColumnsChange={onGridColumnsChange}
            dropTargetPath={dropTargetPath}
            onStartDragOut={onStartDragOut}
            onInternalDrop={onInternalDrop}
            onInternalHover={onInternalHover}
            onEntryContextMenu={onEntryContextMenu}
          />
        </PerfProfiler>
      ) : (
        <PerfProfiler id="file-list">
          <FileList
            {...viewProps}
            smoothScroll={smoothScroll}
            compactMode={compactMode}
            sortState={sortState}
            onSortChange={onSortChange}
            categoryTinting={categoryTinting}
            presenceEnabled={presenceEnabled}
            dropTargetPath={dropTargetPath}
            onStartDragOut={onStartDragOut}
            onInternalDrop={onInternalDrop}
            onInternalHover={onInternalHover}
            onEntryContextMenu={onEntryContextMenu}
          />
        </PerfProfiler>
      )}
    </Suspense>
  );
}
