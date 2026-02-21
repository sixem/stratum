// Entry metadata cache + batching for file size/modified lookups.
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { statEntries } from "@/api";
import { META_CACHE_LIMIT, META_FLUSH_INTERVAL_MS } from "@/constants";
import type { EntryMeta, FileEntry } from "@/types";
import { getInlineEntryMeta } from "./fileManager.query";
import type { FileManagerDebug, MetaRequestOptions } from "./fileManager.types";

type UseEntryMetaCacheOptions = {
  loadIdRef: MutableRefObject<number>;
  perf: FileManagerDebug;
};

export const useEntryMetaCache = ({ loadIdRef, perf }: UseEntryMetaCacheOptions) => {
  const [entryMeta, setEntryMeta] = useState<Map<string, EntryMeta>>(new Map());
  const entryMetaRef = useRef(entryMeta);
  const pendingMetaRef = useRef(new Set<string>());
  const metaCacheRef = useRef<Map<string, EntryMeta>>(new Map());
  const metaDirtyRef = useRef(false);
  const metaFlushTimerRef = useRef<number | null>(null);

  const trimMetaCache = useCallback((cache: Map<string, EntryMeta>) => {
    while (cache.size > META_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);

  const scheduleMetaFlush = useCallback(() => {
    if (metaFlushTimerRef.current != null) return;
    metaFlushTimerRef.current = window.setTimeout(() => {
      metaFlushTimerRef.current = null;
      if (!metaDirtyRef.current) return;
      metaDirtyRef.current = false;
      // De-prioritize meta commits so scrolling and interaction stay responsive.
      startTransition(() => {
        setEntryMeta(entryMetaRef.current);
      });
    }, META_FLUSH_INTERVAL_MS);
  }, []);

  const resetMetaFlush = useCallback(() => {
    metaDirtyRef.current = false;
    if (metaFlushTimerRef.current != null) {
      window.clearTimeout(metaFlushTimerRef.current);
      metaFlushTimerRef.current = null;
    }
  }, []);

  const flushEntryMeta = useCallback(() => {
    if (!metaDirtyRef.current) return;
    resetMetaFlush();
    // Flush meta updates without blocking input/scroll work.
    startTransition(() => {
      setEntryMeta(entryMetaRef.current);
    });
  }, [resetMetaFlush]);

  const primeEntryMeta = useCallback(
    (items: FileEntry[]) => {
      resetMetaFlush();
      pendingMetaRef.current.clear();
      const cache = metaCacheRef.current;
      const next = new Map<string, EntryMeta>();
      items.forEach((entry) => {
        const fromEntry = getInlineEntryMeta(entry);
        const cached = cache.get(entry.path);
        const meta = fromEntry ?? cached;
        if (!meta) return;
        cache.delete(entry.path);
        cache.set(entry.path, meta);
        next.set(entry.path, meta);
      });
      trimMetaCache(cache);
      entryMetaRef.current = next;
      // Treat large metadata refreshes as non-urgent UI work.
      startTransition(() => {
        setEntryMeta(next);
      });
    },
    [resetMetaFlush, trimMetaCache],
  );

  const requestEntryMeta = useCallback(
    async (paths: string[], options?: MetaRequestOptions): Promise<EntryMeta[]> => {
      if (paths.length === 0) return [];
      const unique = new Set(paths.map((path) => path.trim()).filter(Boolean));
      const meta = entryMetaRef.current;
      const missing = Array.from(unique).filter(
        (path) =>
          !pendingMetaRef.current.has(path) && (options?.force ? true : !meta.has(path)),
      );
      if (missing.length === 0) return [];

      const batch = missing.slice(0, 120);
      batch.forEach((path) => pendingMetaRef.current.add(path));
      const currentLoad = loadIdRef.current;
      if (perf.enabled) {
        perf("stat_entries queued: batch=%d missing=%d", batch.length, missing.length);
      }

      try {
        const start = perf.enabled ? performance.now() : 0;
        const results = await statEntries(batch);
        if (loadIdRef.current !== currentLoad) return [];
        if (results.length === 0) return [];
        if (perf.enabled) {
          perf(
            "stat_entries returned: %d entries in %dms",
            results.length,
            Math.round(performance.now() - start),
          );
        }
        const cache = metaCacheRef.current;
        const next = new Map(entryMetaRef.current);
        results.forEach((nextMeta) => {
          cache.delete(nextMeta.path);
          cache.set(nextMeta.path, nextMeta);
          next.set(nextMeta.path, nextMeta);
        });
        trimMetaCache(cache);
        entryMetaRef.current = next;
        metaDirtyRef.current = true;
        if (!options?.defer) {
          scheduleMetaFlush();
        }
        return results;
      } catch (error) {
        if (perf.enabled) {
          perf("stat_entries failed: %o", error);
        }
        return [];
      } finally {
        batch.forEach((path) => pendingMetaRef.current.delete(path));
      }
    },
    [loadIdRef, perf, scheduleMetaFlush, trimMetaCache],
  );

  useEffect(() => {
    return () => {
      resetMetaFlush();
    };
  }, [resetMetaFlush]);

  return {
    entryMeta,
    entryMetaRef,
    primeEntryMeta,
    requestEntryMeta,
    flushEntryMeta,
  };
};
