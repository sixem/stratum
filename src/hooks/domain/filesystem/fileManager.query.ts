// Query key + sorting helpers shared by directory loading and cache lookups.
import { DEFAULT_SORT, normalizePath, sortEntries } from "@/lib";
import type { EntryMeta, FileEntry } from "@/types";
import type { ListDirQuery, LoadDirOptions } from "./fileManager.types";

const normalizeSearch = (value: string) => value.trim().toLowerCase();

export const buildQueryKey = (path: string, query: ListDirQuery) => {
  const normalizedPath = normalizePath(path);
  const normalizedSearch = normalizeSearch(query.search);
  return `${normalizedPath}:${query.sort.key}:${query.sort.dir}:${normalizedSearch}`;
};

export const resolveQuery = (
  options?: LoadDirOptions,
  last?: ListDirQuery | null,
): ListDirQuery => {
  return {
    sort: options?.sort ?? last?.sort ?? DEFAULT_SORT,
    search: options?.search ?? last?.search ?? "",
  };
};

const toEntryMeta = (entry: FileEntry): EntryMeta | null => {
  if (entry.size == null && entry.modified == null) return null;
  return {
    path: entry.path,
    size: entry.size ?? null,
    modified: entry.modified ?? null,
  };
};

// Canonicalize entry ordering in the UI layer so cached and refreshed snapshots
// follow the same deterministic order across tab switches.
export const normalizeEntriesOrder = (items: FileEntry[], sort: ListDirQuery["sort"]) => {
  if (sort.key === "name") return items;
  if (items.length <= 1) return items;
  const metaMap = new Map<string, EntryMeta>();
  items.forEach((entry) => {
    const meta = toEntryMeta(entry);
    if (!meta) return;
    metaMap.set(entry.path, meta);
  });
  return sortEntries(items, metaMap, sort);
};

export const getInlineEntryMeta = toEntryMeta;
