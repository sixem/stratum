// Metadata lookup and caching for list rows.
import type { RefObject } from "react";
import { useMemo, useRef } from "react";
import { useEntryMetaRequest, useScrollSettled } from "@/hooks";
import { buildEntryTooltip, formatBytes, formatDate, getFileKind } from "@/lib";
import type { EntryItem, FileKind } from "@/lib";
import type { EntryMeta } from "@/types";

type RowDisplayMeta = {
  tooltipText: string;
  fileKind: FileKind;
  sizeLabel: string;
  modifiedLabel: string;
};

type CachedRowDisplayMeta = RowDisplayMeta & {
  signature: string;
};

type UseListMetaOptions = {
  listRef: RefObject<HTMLDivElement | null>;
  viewKey: string;
  visibleRows: EntryItem[];
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  loading: boolean;
};

const ROW_META_CACHE_LIMIT = 5000;

const upsertRowMetaCache = (
  cache: Map<string, CachedRowDisplayMeta>,
  key: string,
  value: CachedRowDisplayMeta,
) => {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > ROW_META_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

export const useListMeta = ({
  listRef,
  viewKey,
  visibleRows,
  entryMeta,
  onRequestMeta,
  loading,
}: UseListMetaOptions): Map<string, RowDisplayMeta> => {
  const scrolling = useScrollSettled(listRef);
  const metaPaths = useMemo(() => {
    const next: string[] = [];
    visibleRows.forEach((row) => {
      if (row.type !== "entry") return;
      if (row.presence === "removed") return;
      if (row.entry.isDir) return;
      next.push(row.entry.path);
    });
    return next;
  }, [visibleRows]);

  useEntryMetaRequest(loading || scrolling, metaPaths, onRequestMeta);

  const rowMetaCacheRef = useRef<Map<string, CachedRowDisplayMeta>>(new Map());

  const rowMetaByPath = useMemo(() => {
    const cache = rowMetaCacheRef.current;
    const next = new Map<string, RowDisplayMeta>();
    visibleRows.forEach((row) => {
      if (row.type !== "entry") return;
      if (row.presence === "removed") return;
      const entry = row.entry;
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
        const sizeLabel = entry.isDir ? "-" : formatBytes(resolvedSize);
        const modifiedLabel = entry.isDir
          ? "-"
          : resolvedModified == null
            ? "..."
            : formatDate(resolvedModified);
        resolved = {
          tooltipText: buildEntryTooltip(row.entry, resolvedMeta),
          // File kind drives category tinting for list view dots.
          fileKind: entry.isDir ? "generic" : getFileKind(entry.name),
          sizeLabel,
          modifiedLabel,
          signature,
        };
        upsertRowMetaCache(cache, cacheKey, resolved);
      }
      next.set(path, resolved);
    });
    return next;
  }, [entryMeta, viewKey, visibleRows]);

  return rowMetaByPath;
};
