// Shared file manager types used across focused filesystem hooks.
import type { FileEntry, ListDirOptions, SortState } from "@/types";

export type StatusLevel = "idle" | "loading" | "error";

export type StatusState = {
  level: StatusLevel;
  message: string;
};

export type ListDirQuery = {
  sort: SortState;
  search: string;
};

export type LoadDirOptions = ListDirOptions & {
  force?: boolean;
  silent?: boolean;
};

export type DirCacheEntry = {
  entries: FileEntry[];
  totalCount: number;
  parentPath: string | null;
};

export type MetaRequestOptions = {
  defer?: boolean;
  // Force re-stat even when metadata is already cached.
  force?: boolean;
};

export type RenameRequest = {
  path: string;
  nextName: string;
};

export type RenameFailure = {
  path: string;
  nextName: string;
  message: string;
};

export type RenameBatchResult = {
  renamed: Map<string, string>;
  failures: RenameFailure[];
};

export type FileManagerDebug = ((...args: unknown[]) => void) & {
  enabled?: boolean;
};
