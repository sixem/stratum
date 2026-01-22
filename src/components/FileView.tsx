// Switches between list and grid file views.
import { Suspense, lazy } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { GridNameEllipsis, GridSize } from "@/modules";
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
  itemIndexMap: Map<string, number>;
  loading: boolean;
  showLander: boolean;
  searchQuery: string;
  scrollKey: string;
  initialScrollTop: number;
  scrollReady: boolean;
  scrollRequest?: { index: number; nonce: number } | null;
  smoothScroll: boolean;
  selectedPaths: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onOpenDir: (path: string) => void;
  onOpenDirNewTab?: (path: string) => void;
  onOpenEntry: (path: string) => void;
  onSelectItem: (path: string, index: number, event: ReactMouseEvent) => void;
  onClearSelection: () => void;
  onScrollTopChange: (key: string, scrollTop: number) => void;
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  thumbnailsEnabled: boolean;
  thumbnails: Map<string, string>;
  onRequestThumbs: (requests: ThumbnailRequest[]) => void;
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
  categoryTinting,
  gridSize,
  gridShowSize,
  gridShowExtension,
  gridNameEllipsis,
  gridNameHideExtension,
  thumbResetKey,
  scrollKey,
  scrollReady,
  onGridColumnsChange,
  dropTargetPath,
  onStartDragOut,
  onEntryContextMenu,
  smoothScroll,
  itemIndexMap,
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
            scrollKey={scrollKey}
            scrollReady={scrollReady}
            smoothScroll={smoothScroll}
            itemIndexMap={itemIndexMap}
            thumbnailsEnabled={thumbnailsEnabled}
            thumbnails={thumbnails}
            onRequestThumbs={onRequestThumbs}
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
            scrollKey={scrollKey}
            scrollReady={scrollReady}
            smoothScroll={smoothScroll}
            itemIndexMap={itemIndexMap}
            dropTargetPath={dropTargetPath}
            onStartDragOut={onStartDragOut}
            onEntryContextMenu={onEntryContextMenu}
          />
        </PerfProfiler>
      )}
    </Suspense>
  );
}
