// Switches between list and grid file views.
import { Suspense, lazy } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { GridNameEllipsis, GridSize, ThumbnailFit } from "@/modules";
import type { EntryItem } from "@/lib";
import type { EntryMeta, FileEntry, ThumbnailRequest, ViewMode } from "@/types";
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
  onGridColumnsChange?: (columns: number) => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
  onEntryContextMenu?: (
    event: ReactMouseEvent,
    target: { path: string; isDir: boolean },
  ) => void;
  dropTargetPath?: string | null;
  onStartDragOut?: (paths: string[]) => void;
};

export function FileView({
  viewMode,
  showLander,
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
  onGridColumnsChange,
  dropTargetPath,
  onStartDragOut,
  onEntryContextMenu,
  smoothScroll,
  ...viewProps
}: FileViewProps) {
  // Keep the heavy views lazy-loaded but render-driven.
  if (showLander) {
    return <StartLander />;
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
            onGridColumnsChange={onGridColumnsChange}
            dropTargetPath={dropTargetPath}
            onStartDragOut={onStartDragOut}
            onEntryContextMenu={onEntryContextMenu}
          />
        </PerfProfiler>
      ) : (
        <PerfProfiler id="file-list">
          <FileList
            {...viewProps}
            smoothScroll={smoothScroll}
            dropTargetPath={dropTargetPath}
            onStartDragOut={onStartDragOut}
            onEntryContextMenu={onEntryContextMenu}
          />
        </PerfProfiler>
      )}
    </Suspense>
  );
}
