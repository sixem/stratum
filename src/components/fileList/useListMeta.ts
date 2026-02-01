// Metadata lookup and caching for list rows.
import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
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

type UseListMetaOptions = {
  listRef: RefObject<HTMLDivElement | null>;
  viewKey: string;
  visibleRows: EntryItem[];
  entryMeta: Map<string, EntryMeta>;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  loading: boolean;
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

  const rowMetaCacheRef = useRef<Map<string, RowDisplayMeta>>(new Map());

  useEffect(() => {
    // Reset cached row labels on view changes to keep memory bounded.
    rowMetaCacheRef.current.clear();
  }, [viewKey]);

  const rowMetaByPath = useMemo(() => {
    const cache = rowMetaCacheRef.current;
    const next = new Map<string, RowDisplayMeta>();
    visibleRows.forEach((row) => {
      if (row.type !== "entry") return;
      if (row.presence === "removed") return;
      const entry = row.entry;
      const path = entry.path;
      const meta = entryMeta.get(path);
      const cacheKey = `${path}:${meta?.modified ?? "none"}:${meta?.size ?? "none"}`;
      let resolved = cache.get(cacheKey);
      if (!resolved) {
        const sizeLabel = entry.isDir ? "-" : formatBytes(meta?.size ?? null);
        const modifiedLabel = entry.isDir
          ? "-"
          : meta?.modified == null
            ? "..."
            : formatDate(meta.modified);
        resolved = {
          tooltipText: buildEntryTooltip(row.entry, meta),
          // File kind drives category tinting for list view dots.
          fileKind: entry.isDir ? "generic" : getFileKind(entry.name),
          sizeLabel,
          modifiedLabel,
        };
        cache.set(cacheKey, resolved);
      }
      next.set(path, resolved);
    });
    return next;
  }, [entryMeta, visibleRows]);

  return rowMetaByPath;
};
