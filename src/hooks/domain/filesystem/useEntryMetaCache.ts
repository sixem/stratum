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
  const [entryMeta, setEntryMeta] = useState(() => new Map<string, EntryMeta>());
  const entryMetaRef = useRef(entryMeta);
  const pendingMetaRef = useRef(new Set<string>());
  const metaCacheRef = useRef<Map<string, EntryMeta>>(new Map());
  const metaUpdatesRef = useRef(new Map<string, EntryMeta>());
  const metaFlushTimerRef = useRef<number | null>(null);

  const trimMetaCache = useCallback((cache: Map<string, EntryMeta>) => {
    const keys = cache.keys();
    while (cache.size > META_CACHE_LIMIT) {
      const oldest = keys.next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }, []);

  const clearMetaFlushTimer = useCallback(() => {
    if (metaFlushTimerRef.current != null) {
      window.clearTimeout(metaFlushTimerRef.current);
      metaFlushTimerRef.current = null;
    }
  }, []);

  const flushEntryMeta = useCallback(() => {
    clearMetaFlushTimer();
    const updates = metaUpdatesRef.current;
    if (updates.size === 0) return;
    // Publish one immutable directory snapshot for all completed stat batches.
    const next = new Map(entryMetaRef.current);
    for (const [path, meta] of updates) next.set(path, meta);
    updates.clear();
    entryMetaRef.current = next;
    startTransition(() => {
      setEntryMeta(next);
    });
  }, [clearMetaFlushTimer]);

  const scheduleMetaFlush = useCallback(() => {
    if (metaFlushTimerRef.current != null) return;
    metaFlushTimerRef.current = window.setTimeout(flushEntryMeta, META_FLUSH_INTERVAL_MS);
  }, [flushEntryMeta]);

  const primeEntryMeta = useCallback(
    (items: FileEntry[]) => {
      clearMetaFlushTimer();
      metaUpdatesRef.current.clear();
      pendingMetaRef.current = new Set();
      const cache = metaCacheRef.current;
      const next = new Map<string, EntryMeta>();
      items.forEach((entry) => {
        const meta = getInlineEntryMeta(entry) ?? cache.get(entry.path);
        if (meta) next.set(entry.path, meta);
      });
      if (next.size >= META_CACHE_LIMIT) {
        // This listing replaces the entire warm cache. Keep just its newest
        // entries without inserting and evicting every row of a huge folder.
        const recent = next.entries();
        for (let i = next.size - META_CACHE_LIMIT; i > 0; i--) recent.next();
        metaCacheRef.current = new Map(recent);
      } else {
        for (const [path, meta] of next) {
          cache.delete(path);
          cache.set(path, meta);
        }
        trimMetaCache(cache);
      }
      entryMetaRef.current = next;
      // Treat large metadata refreshes as non-urgent UI work.
      startTransition(() => {
        setEntryMeta(next);
      });
    },
    [clearMetaFlushTimer, trimMetaCache],
  );

  const requestEntryMeta = useCallback(
    async (paths: string[], options?: MetaRequestOptions): Promise<EntryMeta[]> => {
      if (paths.length === 0) return [];
      const unique = new Set(paths.map((path) => path.trim()).filter(Boolean));
      const meta = entryMetaRef.current;
      const updates = metaUpdatesRef.current;
      const pending = pendingMetaRef.current;
      const missing = Array.from(unique).filter(
        (path) =>
          !pending.has(path) && (options?.force || (!meta.has(path) && !updates.has(path))),
      );
      if (missing.length === 0) return [];

      const batch = missing.slice(0, 120);
      batch.forEach((path) => pending.add(path));
      const currentLoad = loadIdRef.current;
      if (perf.enabled) {
        perf("stat_entries queued: batch=%d missing=%d", batch.length, missing.length);
      }

      try {
        const start = perf.enabled ? performance.now() : 0;
        const results = await statEntries(batch);
        if (loadIdRef.current !== currentLoad || pendingMetaRef.current !== pending) return [];
        if (results.length === 0) return [];
        if (perf.enabled) {
          perf(
            "stat_entries returned: %d entries in %dms",
            results.length,
            Math.round(performance.now() - start),
          );
        }
        const cache = metaCacheRef.current;
        results.forEach((nextMeta) => {
          cache.delete(nextMeta.path);
          cache.set(nextMeta.path, nextMeta);
          updates.set(nextMeta.path, nextMeta);
        });
        trimMetaCache(cache);
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
        batch.forEach((path) => pending.delete(path));
      }
    },
    [loadIdRef, perf, scheduleMetaFlush, trimMetaCache],
  );

  useEffect(() => {
    return () => {
      clearMetaFlushTimer();
      metaUpdatesRef.current.clear();
      // An old IPC response may still arrive after this pane unmounts.
      pendingMetaRef.current = new Set();
    };
  }, [clearMetaFlushTimer]);

  return {
    entryMeta,
    primeEntryMeta,
    requestEntryMeta,
    flushEntryMeta,
  };
};
