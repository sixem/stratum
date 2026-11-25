// Owns the displayed directory snapshot and the request allowed to replace it.
import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { listDirWithParent } from "@/api";
import { toMessage } from "@/lib";
import { DIR_CACHE_ENTRY_LIMIT, DIR_CACHE_LIMIT } from "@/constants";
import type { FileEntry, ListDirOptions } from "@/types";
import { resolveQuery } from "./fileManager.query";
import type { DirCacheEntry, FileManagerDebug, LoadDirOptions } from "./fileManager.types";
import { DirectoryCache } from "./directoryCache";
import { buildQueryKey, DirectoryRequests } from "./directoryRequests";
import type { DirectoryRequest } from "./directoryRequests";

type UseDirectoryLoaderOptions = {
  pane?: "main" | "bottom";
  loadIdRef: MutableRefObject<number>;
  primeEntryMeta: (items: FileEntry[], folder: string, cached?: boolean) => void;
  setMetaListingPending: (pending: boolean) => void;
  reportError: (title: string, message: string) => void;
  getRestoreRevision: () => number;
  log: FileManagerDebug;
  perf: FileManagerDebug;
};

// Keep native request generations monotonic across closing and reopening a pane.
const lastGeneration = { main: 0, bottom: 0 };

export const useDirectoryLoader = ({
  pane = "main",
  loadIdRef,
  primeEntryMeta,
  setMetaListingPending,
  reportError,
  getRestoreRevision,
  log,
  perf,
}: UseDirectoryLoaderOptions) => {
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const currentPathRef = useRef("");
  const [requests] = useState(() => new DirectoryRequests());
  const [cache] = useState(() => new DirectoryCache(DIR_CACHE_LIMIT, DIR_CACHE_ENTRY_LIMIT));

  const peekDirCache = useCallback((path: string, options?: ListDirOptions) => {
    const target = path.trim();
    if (!target) return null;
    const query = resolveQuery(options, requests.displayed?.query);
    return cache.get(buildQueryKey(target, query)) ?? null;
  }, [cache, requests]);

  const showSnapshot = useCallback((request: DirectoryRequest, snapshot: DirCacheEntry, cached = false) => {
    currentPathRef.current = request.path;
    primeEntryMeta(snapshot.entries, request.path, cached);
    setEntries(snapshot.entries);
    setTotalCount(snapshot.totalCount);
    setCurrentPath(request.path);
    setParentPath(snapshot.parentPath);
  }, [primeEntryMeta]);

  const loadDir = useCallback(
    async (path: string, options?: LoadDirOptions) => {
      const target = path.trim();
      if (!target) return;
      const query = resolveQuery(options, requests.pending?.query ?? requests.displayed?.query);
      const key = buildQueryKey(target, query);
      const linked = options?.linked;
      // Keep the counterpart's current listing until the linked folder opens.
      const cached = options?.force || linked ? null : cache.get(key);
      const request = requests.start(target, key, query, Boolean(cached), options);
      if (!request) return;
      setMetaListingPending(true);
      const restoreRevision = getRestoreRevision();
      if (!linked) loadIdRef.current += 1;
      const generation = Math.max(Date.now(), lastGeneration[pane] + 1);
      lastGeneration[pane] = generation;
      setFailedPath(null);
      setLoadingPath(request.foreground && !linked ? target : null);
      if (cached) {
        cache.remember(key, cached);
        requests.commit(request);
        showSnapshot(request, cached, true);
      }

      log("loadDir start: %s", target);
      const start = perf.enabled ? performance.now() : 0;
      try {
        // The native listing already returns folders first in the requested order.
        const result = await listDirWithParent(target, {
          ...query,
          fast: options?.fast ?? query.sort.key === "name",
          includeMeta: options?.includeMeta,
          generation,
          pane,
        });
        if (restoreRevision !== getRestoreRevision() || (linked && !linked.isCurrent()) || !requests.commit(request)) return;
        if (linked) {
          loadIdRef.current += 1;
          linked.onCommit();
        }
        if (perf.enabled) {
          perf(
            "list_dir_with_parent: %s (%d of %d entries) in %dms",
            target, result.entries.length, result.totalCount, Math.round(performance.now() - start),
          );
        }
        showSnapshot(request, result);
        cache.remember(key, result);
        log("loadDir done: %s (%d entries)", target, result.entries.length);
      } catch (error) {
        if (restoreRevision !== getRestoreRevision() || requests.pending !== request) return;
        if (linked) {
          linked.onUnavailable();
          return;
        }
        setFailedPath(target);
        log("loadDir error: %s (%o)", target, error);
        if (!options?.suppressError) {
          reportError("Couldn't open folder", `Failed to open ${target}: ${toMessage(error, "unknown error")}`);
        }
      } finally {
        if (requests.finish(request)) {
          setMetaListingPending(false);
          setLoadingPath(null);
        }
      }
    },
    [cache, pane, loadIdRef, log, perf, reportError, getRestoreRevision, requests, setMetaListingPending, showSnapshot],
  );

  const refresh = useCallback(async () => {
    const target = requests.pending ?? requests.displayed;
    if (target) await loadDir(target.path, { ...target.query, force: true });
  }, [loadDir, requests]);

  const refreshAfterChange = useCallback(async () => {
    const displayed = requests.displayed;
    if (!displayed) return;
    const query = requests.pending?.query ?? displayed.query;
    await loadDir(displayed.path, { ...query, force: true, silent: true });
  }, [loadDir, requests]);

  const clearDir = useCallback((_options?: { silent?: boolean }) => {
    requests.clear();
    loadIdRef.current += 1;
    currentPathRef.current = "";
    primeEntryMeta([], "");
    setMetaListingPending(false);
    setEntries([]);
    setTotalCount(0);
    setCurrentPath("");
    setParentPath(null);
    setLoadingPath(null);
    setFailedPath(null);
  }, [loadIdRef, primeEntryMeta, requests, setMetaListingPending]);

  return {
    currentPath, parentPath, entries, totalCount, loadingPath, failedPath, currentPathRef,
    loadDir, clearDir, peekDirCache, refresh, refreshAfterChange,
  };
};
