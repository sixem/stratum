// Switches between list and grid file views.
import { Suspense, lazy } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { GridNameEllipsis, GridSize } from "@/modules";
import type { EntryMeta, FileEntry, ViewMode } from "@/types";
import { LoadingIndicator } from "./LoadingIndicator";

const FileList = lazy(() => import("./FileList"));
const FileGrid = lazy(() => import("./FileGrid"));

type FileViewProps = {
  viewMode: ViewMode;
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
  thumbnailsEnabled: boolean;
  thumbnails: Map<string, string>;
  onRequestThumbs: (paths: string[]) => void;
  categoryTinting: boolean;
  gridSize: GridSize;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  thumbResetKey?: string;
  blockReveal: boolean;
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
  blockReveal,
  scrollKey,
  onGridColumnsChange,
  dropTargetPath,
  onStartDragOut,
  onEntryContextMenu,
  ...viewProps
}: FileViewProps) {
  // Keep the heavy views lazy-loaded but render-driven.
  return (
    <Suspense
      fallback={
        <div className="loading-splash">
          <LoadingIndicator />
        </div>
      }
    >
      {viewMode === "thumbs" ? (
        <FileGrid
          key={`grid:${scrollKey}`}
          {...viewProps}
          scrollKey={scrollKey}
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
          blockReveal={blockReveal}
          onGridColumnsChange={onGridColumnsChange}
          dropTargetPath={dropTargetPath}
          onStartDragOut={onStartDragOut}
          onEntryContextMenu={onEntryContextMenu}
        />
      ) : (
        <FileList
          key={`list:${scrollKey}`}
          {...viewProps}
          scrollKey={scrollKey}
          blockReveal={blockReveal}
          dropTargetPath={dropTargetPath}
          onStartDragOut={onStartDragOut}
          onEntryContextMenu={onEntryContextMenu}
        />
      )}
    </Suspense>
  );
}
