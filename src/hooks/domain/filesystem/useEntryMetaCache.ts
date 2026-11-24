// Entry metadata cache + batching for file size/modified lookups.
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { statEntries } from "@/api";
import { META_CACHE_LIMIT, META_FLUSH_INTERVAL_MS } from "@/constants";
import { folderPathKey, getParentPath } from "@/lib/paths";
import type { EntryMeta, FileEntry } from "@/types";
import { EntryMetaRefreshQueue } from "./entryMetaRefreshQueue";
import { EntryMetaSnapshot } from "./entryMetaSnapshot";
import { getInlineEntryMeta } from "./fileManager.query";
import type { FileManagerDebug, MetaRequestOptions } from "./fileManager.types";

const LOOKUP_BATCH_SIZE = 120;
const WATCH_BATCH_INTERVAL_MS = 16;
const WATCH_RETRY_DELAY_MS = 250;

type UseEntryMetaCacheOptions = {
  loadIdRef: MutableRefObject<number>;
  perf: FileManagerDebug;
};

export const useEntryMetaCache = ({ loadIdRef, perf }: UseEntryMetaCacheOptions) => {
  const [entryMeta, setEntryMeta] = useState(() => new EntryMetaSnapshot());
  const entryMetaRef = useRef(entryMeta);
  const pendingMetaRef = useRef(new Map<string, symbol>());
  const metaCacheRef = useRef<Map<string, EntryMeta>>(new Map());
  const metaUpdatesRef = useRef(new Map<string, EntryMeta>());
  const metaFlushTimerRef = useRef<number | null>(null);
  const displayedFolderRef = useRef("");
  const [watchQueue] = useState(() => new EntryMetaRefreshQueue());
  const watchMetaTimerRef = useRef<number | null>(null);
  const watchLookupInFlightRef = useRef(false);

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
    const next = entryMetaRef.current.withUpdates(updates);
    updates.clear();
    entryMetaRef.current = next;
    startTransition(() => {
      setEntryMeta(next);
    });
  }, [clearMetaFlushTimer]);

  const scheduleMetaFlush = useCallback(() => {
    if (metaFlushTimerRef.current != null || metaUpdatesRef.current.size === 0) return;
    metaFlushTimerRef.current = window.setTimeout(flushEntryMeta, META_FLUSH_INTERVAL_MS);
  }, [flushEntryMeta]);

  const storeEntryMeta = useCallback((meta: EntryMeta, publish = true) => {
    const cache = metaCacheRef.current;
    cache.delete(meta.path);
    cache.set(meta.path, meta);
    if (!publish) return;
    const pending = metaUpdatesRef.current;
    const previous = pending.get(meta.path) ?? entryMetaRef.current.get(meta.path);
    if (!previous || previous.size !== meta.size || previous.modified !== meta.modified) {
      pending.set(meta.path, meta);
    }
  }, []);

  const scheduleWatchLookups = useCallback(() => {
    if (!watchQueue.ready || watchMetaTimerRef.current != null || watchLookupInFlightRef.current) return;

    async function drainBatch() {
      watchMetaTimerRef.current = null;
      if (!watchQueue.ready) return;
      const batch = watchQueue.take(LOOKUP_BATCH_SIZE);
      let results: EntryMeta[] = [];
      watchLookupInFlightRef.current = true;
      try {
        results = await statEntries(Array.from(batch.entries.values(), ({ path }) => path));
      } catch (error) {
        if (perf.enabled) perf("watch stat_entries failed: %o", error);
      } finally {
        watchLookupInFlightRef.current = false;
      }

      const { updates, failedPaths, checkedFiles, retry } = watchQueue.complete(batch, results);
      for (const meta of updates) {
        const parent = getParentPath(meta.path);
        // Keep the warm cache current across navigation without publishing old rows into the new pane.
        storeEntryMeta(meta, parent !== null && folderPathKey(parent) === displayedFolderRef.current);
      }
      for (const path of failedPaths) metaCacheRef.current.delete(path);
      if (failedPaths.length && perf.enabled) perf("watch stat_entries gave up: paths=%d", failedPaths.length);
      trimMetaCache(metaCacheRef.current);
      if (updates.length) scheduleMetaFlush();
      for (const { path, meta, notify } of checkedFiles) notify(path, meta);
      if (watchQueue.ready) {
        watchMetaTimerRef.current = window.setTimeout(drainBatch, retry ? WATCH_RETRY_DELAY_MS : WATCH_BATCH_INTERVAL_MS);
      }
    }

    watchMetaTimerRef.current = window.setTimeout(drainBatch, 0);
  }, [perf, scheduleMetaFlush, storeEntryMeta, trimMetaCache, watchQueue]);

  const setMetaListingPending = useCallback((pending: boolean) => {
    watchQueue.setListingPending(pending);
    if (!pending) scheduleWatchLookups();
  }, [scheduleWatchLookups, watchQueue]);

  const primeEntryMeta = useCallback(
    (items: FileEntry[], folder: string, cached = false) => {
      clearMetaFlushTimer();
      metaUpdatesRef.current.clear();
      pendingMetaRef.current = new Map();
      const folderKey = folderPathKey(folder);
      if (displayedFolderRef.current !== folderKey) watchQueue.setVisible([]);
      displayedFolderRef.current = folderKey;
      const cache = metaCacheRef.current;
      const next = new Map<string, EntryMeta>();
      items.forEach((entry) => {
        const warm = cache.get(entry.path);
        // A cached listing may predate a watcher repair of the warm metadata.
        const meta = (cached ? warm : null) ?? getInlineEntryMeta(entry) ?? warm;
        if (meta) next.set(entry.path, meta);
      });
      if (next.size >= META_CACHE_LIMIT) {
        // This listing replaces the entire warm cache. Keep just its newest
        // entries without inserting and evicting every row of a huge folder.
        const recent = next.entries();
        for (let i = next.size - META_CACHE_LIMIT; i > 0; i--) recent.next();
        metaCacheRef.current = new Map(recent);
      } else {
        for (const meta of next.values()) storeEntryMeta(meta, false);
        trimMetaCache(cache);
      }
      const snapshot = new EntryMetaSnapshot(next);
      entryMetaRef.current = snapshot;
      // Treat large metadata refreshes as non-urgent UI work.
      startTransition(() => {
        setEntryMeta(snapshot);
      });
    },
    [clearMetaFlushTimer, storeEntryMeta, trimMetaCache, watchQueue],
  );

  const requestEntryMeta = useCallback(
    async (paths: string[], options?: MetaRequestOptions): Promise<EntryMeta[]> => {
      if (paths.length === 0) return [];
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      const meta = entryMetaRef.current;
      const updates = metaUpdatesRef.current;
      const pending = pendingMetaRef.current;
      if (options?.force) {
        for (const path of unique) {
          pending.delete(folderPathKey(path));
          updates.delete(path);
          watchQueue.invalidate(path, options.onFileChecked);
        }
        scheduleWatchLookups();
        return [];
      }
      // The virtualized pane requests its visible rows before any background prefetch.
      if (!options?.defer) watchQueue.setVisible(unique);
      const missing = unique.filter((path) => {
        const key = folderPathKey(path);
        return !pending.has(key) && !watchQueue.has(key) && !meta.has(path) && !updates.has(path);
      });
      if (missing.length === 0) return [];

      const batch = missing.slice(0, LOOKUP_BATCH_SIZE);
      const lookup = Symbol();
      for (const path of batch) pending.set(folderPathKey(path), lookup);
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
        const current = results.filter(({ path }) => pending.get(folderPathKey(path)) === lookup);
        for (const nextMeta of current) storeEntryMeta(nextMeta);
        trimMetaCache(metaCacheRef.current);
        if (!options?.defer) {
          scheduleMetaFlush();
        }
        return current;
      } catch (error) {
        if (perf.enabled) {
          perf("stat_entries failed: %o", error);
        }
        return [];
      } finally {
        for (const path of batch) {
          const key = folderPathKey(path);
          if (pending.get(key) === lookup) pending.delete(key);
        }
      }
    },
    [loadIdRef, perf, scheduleMetaFlush, scheduleWatchLookups, storeEntryMeta, trimMetaCache, watchQueue],
  );

  useEffect(() => {
    return () => {
      clearMetaFlushTimer();
      metaUpdatesRef.current.clear();
      if (watchMetaTimerRef.current != null) window.clearTimeout(watchMetaTimerRef.current);
      watchMetaTimerRef.current = null;
      watchQueue.clear();
      // An old IPC response may still arrive after this pane unmounts.
      pendingMetaRef.current = new Map();
    };
  }, [clearMetaFlushTimer, watchQueue]);

  return {
    entryMeta,
    primeEntryMeta,
    setMetaListingPending,
    requestEntryMeta,
    flushEntryMeta,
  };
};
