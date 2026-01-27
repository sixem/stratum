import type { SortState } from "./sort";

export type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  modified: number | null;
};

export type ListDirOptions = {
  sort?: SortState;
  search?: string;
  fast?: boolean;
  // Optional request generation so the backend can cancel stale scans.
  generation?: number;
};

export type ListDirResult = {
  entries: FileEntry[];
  totalCount: number;
};

export type ListDirWithParentResult = {
  entries: FileEntry[];
  totalCount: number;
  parentPath: string | null;
};

export type Place = {
  name: string;
  path: string;
};

export type EntryMeta = {
  path: string;
  size: number | null;
  modified: number | null;
};

export type DriveInfo = {
  path: string;
  free: number | null;
  total: number | null;
  label?: string | null;
};

export type CopyReport = {
  copied: number;
  skipped: number;
  failures: string[];
};

export type TransferMode = "copy" | "move" | "auto";

export type TransferReport = {
  copied: number;
  moved: number;
  skipped: number;
  failures: string[];
};

// Emitted while a copy/move operation progresses.
export type TransferProgressEvent = {
  id: string;
  processed: number;
  total: number;
  currentPath?: string | null;
  currentBytes?: number | null;
  currentTotalBytes?: number | null;
};

export type DeleteReport = {
  deleted: number;
  skipped: number;
  failures: string[];
};

// Emitted when the native watcher detects a change in a watched directory.
export type DirChangedEvent = {
  path: string;
};

// Emitted when the native watcher detects a rename in a watched directory.
export type DirRenameEvent = {
  path: string;
  from: string;
  to: string;
};
