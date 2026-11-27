// Grouped prop contracts for the list view.
// Keeping the slices explicit makes the list and grid views easier to align
// while still letting each view keep its own presentation details.
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { EntryItem } from "@/lib";
import type { ScrollRequest } from "@/hooks";
import type { GridNameEllipsis } from "@/modules";
import type { EntryMeta, EntryMetaLookup, FileEntry, RenameCommitReason, SortState } from "@/types";

export type FileListEntryContextTarget = {
  name: string;
  path: string;
  isDir: boolean;
};

export type FileListViewProps = {
  remote?: boolean;
  currentPath: string;
  entryByPath: Map<string, FileEntry>;
  items: EntryItem[];
  indexMap?: Map<string, number>;
  loading: boolean;
  searchQuery: string;
  viewKey: string;
  scrollRestoreKey: string;
  scrollRestoreTop: number;
  scrollRequest?: ScrollRequest | null;
  smoothScroll: boolean;
  canGoUp?: boolean;
  onGoUp?: () => void;
};

export type FileListSelectionProps = {
  pendingDeletePaths: Set<string>;
  pendingTransferPaths: Set<string>;
  selectedPaths: Set<string>;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onSelectItem: (path: string, index: number, event: ReactMouseEvent) => void;
  onClearSelection: () => void;
};

export type FileListNavigationProps = {
  onOpenDir: (path: string) => void;
  onOpenDirNewTab?: (path: string) => void;
  canBrowseEntry?: (path: string) => boolean;
  onOpenEntry: (path: string) => void;
};

export type FileListRenameProps = {
  renameTargetPath?: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: (reason: RenameCommitReason) => void;
  onRenameCancel: () => void;
};

export type FileListMetadataProps = {
  entryMeta: EntryMetaLookup;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
};

export type FileListListProps = {
  onVisibleEntries?: (entries: FileEntry[]) => void;
  sortState: SortState;
  onSortChange: (next: SortState) => void;
  categoryTinting: boolean;
  nameEllipsis: GridNameEllipsis;
  hideExtension: boolean;
  presenceEnabled?: boolean;
};

export type FileListContextMenuProps = {
  onContextMenu?: (event: ReactPointerEvent) => void;
  onContextMenuDown?: (event: ReactPointerEvent) => void;
  onEntryContextMenu?: (
    event: ReactPointerEvent,
    target: FileListEntryContextTarget,
  ) => void;
  onEntryContextMenuDown?: (
    event: ReactPointerEvent,
    target: FileListEntryContextTarget,
  ) => void;
};

export type FileListPreviewProps = {
  onEntryPreviewPress?: (path: string) => boolean;
  onEntryPreviewRelease?: (path: string) => boolean;
};

export type FileListDragDropProps = {
  dropTargetPath?: string | null;
  onStartDragOut?: (paths: string[], folderPath?: string) => void;
};

export type FileListCreationProps = {
  preserveWhitespace?: boolean;
  onCreateFolder: (parentPath: string, name: string) => Promise<unknown> | void;
  onCreateFolderAndGo?: (parentPath: string, name: string) => Promise<unknown> | void;
  onCreateFile: (parentPath: string, name: string) => Promise<unknown> | void;
};

export type FileListProps = {
  view: FileListViewProps;
  selection: FileListSelectionProps;
  navigation: FileListNavigationProps;
  rename: FileListRenameProps;
  metadata: FileListMetadataProps;
  list: FileListListProps;
  contextMenu: FileListContextMenuProps;
  preview: FileListPreviewProps;
  dragDrop: FileListDragDropProps;
  creation?: FileListCreationProps;
};
