// Display metadata cache for file-grid cards.
//
// Grid cards need cheap, stable labels while the user scrolls. This hook keeps
// the path/signature cache separate from thumbnail request orchestration.
import { useMemo, useRef } from "react";

import { formatBytes, getExtension, getFileKind } from "@/lib";
import type { EntryItem, FileKind } from "@/lib";
import type { EntryMeta } from "@/types";

export type GridDisplayMeta = {
  fileKind: FileKind;
  extension: string | null;
  sizeLabel: string | null;
};

type CachedGridDisplayMeta = GridDisplayMeta & {
  signature: string;
};

type UseGridDisplayMetaOptions = {
  viewKey: string;
  visibleItems: EntryItem[];
  entryMeta: Map<string, EntryMeta>;
};

const GRID_META_CACHE_LIMIT = 5000;

const upsertGridMetaCache = (
  cache: Map<string, CachedGridDisplayMeta>,
  key: string,
  value: CachedGridDisplayMeta,
) => {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > GRID_META_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

export const useGridDisplayMeta = ({
  viewKey,
  visibleItems,
  entryMeta,
}: UseGridDisplayMetaOptions): Map<string, GridDisplayMeta> => {
  const entryMetaCacheRef = useRef<Map<string, CachedGridDisplayMeta>>(new Map());

  return useMemo(() => {
    const cache = entryMetaCacheRef.current;
    const next = new Map<string, GridDisplayMeta>();
    visibleItems.forEach((item) => {
      if (item.type !== "entry") return;
      if (item.presence === "removed") return;
      const entry = item.entry;
      const path = entry.path;
      const meta = entryMeta.get(path);
      const resolvedMeta: EntryMeta | undefined =
        meta ??
        (entry.size != null || entry.modified != null
          ? {
              path,
              size: entry.size ?? null,
              modified: entry.modified ?? null,
            }
          : undefined);
      const resolvedSize = resolvedMeta?.size ?? null;
      const resolvedModified = resolvedMeta?.modified ?? null;
      const cacheKey = `${viewKey}:${path}`;
      const signature = `${resolvedModified ?? "none"}:${resolvedSize ?? "none"}`;
      const cached = cache.get(cacheKey);
      const canReuseCached =
        cached != null && (signature === "none:none" || cached.signature === signature);
      if (canReuseCached) {
        next.set(path, cached);
        return;
      }
      let resolved = cached;
      if (!resolved || resolved.signature !== signature) {
        const extension = entry.isDir ? null : getExtension(entry.name);
        resolved = {
          fileKind: entry.isDir ? "generic" : getFileKind(entry.name),
          extension,
          sizeLabel: entry.isDir
            ? "Folder"
            : resolvedSize == null
              ? null
              : formatBytes(resolvedSize),
          signature,
        };
        upsertGridMetaCache(cache, cacheKey, resolved);
      }
      next.set(path, resolved);
    });
    return next;
  }, [entryMeta, viewKey, visibleItems]);
};
