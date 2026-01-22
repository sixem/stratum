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
};

export type CopyReport = {
  copied: number;
  skipped: number;
  failures: string[];
};

export type DeleteReport = {
  deleted: number;
  skipped: number;
  failures: string[];
};
