// Default query settings and inline metadata supplied by native directory listings.
import { DEFAULT_SORT } from "@/lib";
import type { EntryMeta, FileEntry } from "@/types";
import type { ListDirQuery, LoadDirOptions } from "./fileManager.types";

export const resolveQuery = (
  options?: LoadDirOptions,
  last?: ListDirQuery | null,
): ListDirQuery => {
  return {
    sort: options?.sort ?? last?.sort ?? DEFAULT_SORT,
    search: options?.search ?? last?.search ?? "",
  };
};

export const getInlineEntryMeta = (entry: FileEntry): EntryMeta | null => {
  return entry.size == null && entry.modified == null ? null : entry;
};
