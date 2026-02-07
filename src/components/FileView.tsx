// Switches between list and grid file views.
import { Suspense, lazy, useCallback, useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { GridNameEllipsis, GridSize, ThumbnailFit } from "@/modules";
import type { DropTarget, EntryItem } from "@/lib";
import type {
  EntryMeta,
  FileEntry,
  DriveInfo,
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
  currentPath: string;
  entries: FileEntry[];
  items: EntryItem[];
  indexMap?: Map<string, number>;
  loading: boolean;
  showLander: boolean;
  recentJumps: string[];
  onOpenRecent: (path: string) => void;
  onOpenRecentNewTab?: (path: string) => void;
  drives: string[];
  driveInfo: DriveInfo[];
  onOpenDrive: (path: string) => void;
  onOpenDriveNewTab?: (path: string) => void;
  canGoUp: boolean;
  onGoUp: () => void;
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
  onCreateFolder: (parentPath: string, name: string) => void | Promise<unknown>;
  onCreateFolderAndGo?: (parentPath: string, name: string) => void | Promise<unknown>;
  onCreateFile: (parentPath: string, name: string) => void | Promise<unknown>;
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
  thumbnailAppIcons: boolean;
  categoryTinting: boolean;
  gridSize: GridSize;
  gridAutoColumns: number;
  gridGap: number;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  gridInstantResizeKey?: string | number | boolean;
  thumbResetKey?: string;
  presenceEnabled?: boolean;
  onGridColumnsChange?: (columns: number) => void;
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
};

export const FileView = ({
  viewMode,
  currentPath,
  showLander,
  recentJumps,
  onOpenRecent,
  onOpenRecentNewTab,
  drives,
  driveInfo,
  onOpenDrive,
  onOpenDriveNewTab,
  canGoUp,
  onGoUp,
  thumbnailsEnabled,
  thumbnails,
  onRequestThumbs,
  thumbnailFit,
  thumbnailAppIcons,
  categoryTinting,
  gridSize,
  gridAutoColumns,
  gridGap,
  gridShowSize,
  gridShowExtension,
  gridNameEllipsis,
  gridNameHideExtension,
  gridInstantResizeKey,
  thumbResetKey,
  presenceEnabled = true,
  onGridColumnsChange,
  dropTargetPath,
  onStartDragOut,
  onInternalDrop,
  onInternalHover,
  onEntryContextMenu,
  onEntryContextMenuDown,
  smoothScroll,
  compactMode,
  sortState,
  onSortChange,
  onContextMenuDown,
  onCreateFolder,
  onCreateFolderAndGo,
  onCreateFile,
  ...viewProps
}: FileViewProps) => {
  // Cache the last stable auto-grid width so we can avoid a layout jump
  // when the new-tab lander temporarily unmounts the grid.
  const autoGridViewportWidthRef = useRef<number | null>(null);
  const handleAutoGridViewportWidth = useCallback((width: number) => {
    autoGridViewportWidthRef.current = width;
  }, []);

  // Keep the heavy views lazy-loaded but render-driven.
  if (showLander) {
    return (
      <StartLander
        recentJumps={recentJumps}
        onOpenRecent={onOpenRecent}
        onOpenRecentNewTab={onOpenRecentNewTab}
        drives={drives}
        driveInfo={driveInfo}
        onOpenDrive={onOpenDrive}
        onOpenDriveNewTab={onOpenDriveNewTab}
      />
    );
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
            currentPath={currentPath}
            smoothScroll={smoothScroll}
            compactMode={compactMode}
            canGoUp={canGoUp}
            onGoUp={onGoUp}
            thumbnailsEnabled={thumbnailsEnabled}
            thumbnails={thumbnails}
            onRequestThumbs={onRequestThumbs}
            thumbnailFit={thumbnailFit}
            thumbnailAppIcons={thumbnailAppIcons}
            categoryTinting={categoryTinting}
            gridSize={gridSize}
            gridAutoColumns={gridAutoColumns}
            gridGap={gridGap}
            gridShowSize={gridShowSize}
            gridShowExtension={gridShowExtension}
            gridNameEllipsis={gridNameEllipsis}
            gridNameHideExtension={gridNameHideExtension}
            instantResizeKey={gridInstantResizeKey}
            autoViewportWidth={autoGridViewportWidthRef.current ?? undefined}
            onAutoViewportWidthChange={handleAutoGridViewportWidth}
            thumbResetKey={thumbResetKey}
            presenceEnabled={presenceEnabled}
            onGridColumnsChange={onGridColumnsChange}
            onContextMenuDown={onContextMenuDown}
            dropTargetPath={dropTargetPath}
            onStartDragOut={onStartDragOut}
            onInternalDrop={onInternalDrop}
            onInternalHover={onInternalHover}
            onEntryContextMenu={onEntryContextMenu}
            onEntryContextMenuDown={onEntryContextMenuDown}
            onCreateFolder={onCreateFolder}
            onCreateFolderAndGo={onCreateFolderAndGo}
            onCreateFile={onCreateFile}
          />
        </PerfProfiler>
      ) : (
        <PerfProfiler id="file-list">
          <FileList
            {...viewProps}
            currentPath={currentPath}
            smoothScroll={smoothScroll}
            compactMode={compactMode}
            sortState={sortState}
            onSortChange={onSortChange}
            categoryTinting={categoryTinting}
            presenceEnabled={presenceEnabled}
            canGoUp={canGoUp}
            onGoUp={onGoUp}
            onContextMenuDown={onContextMenuDown}
            dropTargetPath={dropTargetPath}
            onStartDragOut={onStartDragOut}
            onInternalDrop={onInternalDrop}
            onInternalHover={onInternalHover}
            onEntryContextMenu={onEntryContextMenu}
            onEntryContextMenuDown={onEntryContextMenuDown}
            onCreateFolder={onCreateFolder}
            onCreateFolderAndGo={onCreateFolderAndGo}
            onCreateFile={onCreateFile}
          />
        </PerfProfiler>
      )}
    </Suspense>
  );
};
