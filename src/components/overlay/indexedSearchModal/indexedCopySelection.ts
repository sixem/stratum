// Indexed Search uses a separate selection for text copy. Details and
// file operations still follow the focused result.

import type { IndexedPathMatch } from "@/types";

export type IndexedCopySelection = {
  anchor: string;
  paths: ReadonlySet<string>;
};

export type IndexedCopyModifiers = {
  range?: boolean;
  toggle?: boolean;
};

export const updateIndexedCopySelection = (
  current: IndexedCopySelection | null,
  path: string,
  focusedPath: string | undefined,
  results: readonly IndexedPathMatch[],
  indexes: ReadonlyMap<string, number>,
  { range, toggle }: IndexedCopyModifiers,
): IndexedCopySelection => {
  const base = current?.paths ?? (focusedPath ? [focusedPath] : []);
  if (range) {
    const anchor = current && indexes.has(current.anchor) ? current.anchor : focusedPath ?? path;
    const start = indexes.get(anchor);
    const end = indexes.get(path);
    if (start != null && end != null) {
      const paths = new Set(toggle ? base : []);
      for (let index = Math.min(start, end); index <= Math.max(start, end); index++) {
        paths.add(results[index].path);
      }
      return { anchor, paths };
    }
  }

  if (toggle) {
    const paths = new Set(base);
    if (!paths.delete(path)) paths.add(path);
    return { anchor: path, paths };
  }

  return { anchor: path, paths: new Set([path]) };
};
