// Sort options passed to the native directory listing.
import type { SortDir, SortKey, SortState } from "@/types";

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
