// Sorting utilities for file entries.
import type { EntryMeta, FileEntry, SortDir, SortKey, SortState } from "@/types";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export const DEFAULT_SORT: SortState = {
  key: "name",
  dir: "asc",
};

export const getDefaultSortDir = (key: SortKey): SortDir => {
  return key === "name" ? "asc" : "desc";
};

export const nextSortState = (current: SortState, key: SortKey): SortState => {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: getDefaultSortDir(key) };
};

const compareNames = (a: FileEntry, b: FileEntry) => {
  return collator.compare(a.name, b.name);
};

const compareNumbers = (a: number | null | undefined, b: number | null | undefined) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const getSize = (entry: FileEntry, metaMap: Map<string, EntryMeta>) => {
  return metaMap.get(entry.path)?.size ?? null;
};

const getModified = (entry: FileEntry, metaMap: Map<string, EntryMeta>) => {
  return metaMap.get(entry.path)?.modified ?? null;
};

// Sorts entries with folders first and stable name fallbacks.
export const sortEntries = (
  entries: FileEntry[],
  metaMap: Map<string, EntryMeta>,
  sort: SortState,
) => {
  if (entries.length <= 1) return entries;
  const direction = sort.dir === "asc" ? 1 : -1;
  const sorted = [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }

    if (sort.key === "name") {
      return compareNames(a, b) * direction;
    }

    if (sort.key === "size") {
      const sizeDiff = compareNumbers(getSize(a, metaMap), getSize(b, metaMap));
      if (sizeDiff !== 0) return sizeDiff * direction;
      return compareNames(a, b);
    }

    const modifiedDiff = compareNumbers(getModified(a, metaMap), getModified(b, metaMap));
    if (modifiedDiff !== 0) return modifiedDiff * direction;
    return compareNames(a, b);
  });

  return sorted;
};
