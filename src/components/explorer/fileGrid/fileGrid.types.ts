// Grouped prop contracts for the grid view.
// Keeping these sections explicit makes it easier to reason about which
// responsibilities belong to selection, rename, thumbnails, and drag/drop.
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { DropTarget, EntryItem } from "@/lib";
import type { GridNameEllipsis, GridSize, ThumbnailFit } from "@/modules";
import type { EntryMeta, FileEntry, RenameCommitReason, ThumbnailRequest } from "@/types";

export type FileGridEntryContextTarget = {
  name: string;
  path: string;
  isDir: boolean;
};

export type FileGridViewProps = {
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
  canGoUp?: boolean;
  onGoUp?: () => void;
};

export type FileGridSelectionProps = {
  pendingDeletePaths: Set<string>;
  selectedPaths: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onSelectItem: (path: string, index: number, event: ReactMouseEvent) => void;
  onClearSelection: () => void;
};

export type FileGridNavigationProps = {
  onOpenDir: (path: string) => void;
  onOpenDirNewTab?: (path: string) => void;
  onOpenEntry: (path: string) => void;
};

export type FileGridRenameProps = {
  renameTargetPath?: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: (reason: RenameCommitReason) => void;
  onRenameCancel: () => void;
};

export type FileGridMetadataProps = {
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
};

export type FileGridThumbProps = {
  thumbnailsEnabled: boolean;
  thumbnails: Map<string, string>;
  onRequestThumbs: (requests: ThumbnailRequest[]) => void;
  thumbnailFit: ThumbnailFit;
  thumbnailAppIcons: boolean;
  thumbnailFolders: boolean;
  thumbnailVideos: boolean;
  thumbnailSvgs: boolean;
  categoryTinting: boolean;
  thumbResetKey?: string;
  presenceEnabled?: boolean;
};

export type FileGridLayoutProps = {
  gridSize: GridSize;
  gridAutoColumns: number;
  gridGap: number;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  autoViewportWidth?: number;
  onAutoViewportWidthChange?: (width: number) => void;
  instantResizeKey?: string | number | boolean;
  onGridColumnsChange?: (columns: number) => void;
};

export type FileGridContextMenuProps = {
  onContextMenu?: (event: ReactPointerEvent) => void;
  onContextMenuDown?: (event: ReactPointerEvent) => void;
  onEntryContextMenu?: (
    event: ReactPointerEvent,
    target: FileGridEntryContextTarget,
  ) => void;
  onEntryContextMenuDown?: (
    event: ReactPointerEvent,
    target: FileGridEntryContextTarget,
  ) => void;
};

export type FileGridPreviewProps = {
  onEntryPreviewPress?: (path: string) => boolean;
  onEntryPreviewRelease?: (path: string) => boolean;
};

export type FileGridDragDropProps = {
  dropTargetPath?: string | null;
  onStartDragOut?: (paths: string[]) => void;
  onInternalDrop?: (paths: string[], target: DropTarget | null) => void;
  onInternalHover?: (target: DropTarget | null) => void;
};

export type FileGridCreationProps = {
  onCreateFolder: (parentPath: string, name: string) => Promise<unknown> | void;
  onCreateFolderAndGo?: (parentPath: string, name: string) => Promise<unknown> | void;
  onCreateFile: (parentPath: string, name: string) => Promise<unknown> | void;
};

export type FileGridProps = {
  view: FileGridViewProps;
  selection: FileGridSelectionProps;
  navigation: FileGridNavigationProps;
  rename: FileGridRenameProps;
  metadata: FileGridMetadataProps;
  thumbs: FileGridThumbProps;
  grid: FileGridLayoutProps;
  contextMenu: FileGridContextMenuProps;
  preview: FileGridPreviewProps;
  dragDrop: FileGridDragDropProps;
  creation: FileGridCreationProps;
};
