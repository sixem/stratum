// Directory loading + warm cache management for the active view.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { listDirWithParent } from "@/api";
import { DEFAULT_SORT, normalizePath, toMessage } from "@/lib";
import { DIR_CACHE_LIMIT, FAST_SORT_THRESHOLD } from "@/constants";
import type { FileEntry, ListDirOptions } from "@/types";
import { buildQueryKey, normalizeEntriesOrder, resolveQuery } from "./fileManager.query";
import type {
  DirCacheEntry,
  FileManagerDebug,
  ListDirQuery,
  LoadDirOptions,
  StatusState,
} from "./fileManager.types";

type UseDirectoryLoaderOptions = {
  loadIdRef: MutableRefObject<number>;
  primeEntryMeta: (items: FileEntry[]) => void;
  reportError: (title: string, message: string) => void;
  log: FileManagerDebug;
  perf: FileManagerDebug;
};

type DirectoryLoaderApi = {
  currentPath: string;
  parentPath: string | null;
  entries: FileEntry[];
  totalCount: number;
  loading: boolean;
  status: StatusState;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<StatusState>>;
  currentPathRef: MutableRefObject<string>;
  loadDir: (path: string, options?: LoadDirOptions) => Promise<void>;
  clearDir: (options?: { silent?: boolean }) => void;
  peekDirCache: (path: string, options?: ListDirOptions) => DirCacheEntry | null;
  refreshAfterChange: () => Promise<void>;
};

export const useDirectoryLoader = ({
  loadIdRef,
  primeEntryMeta,
  reportError,
  log,
  perf,
}: UseDirectoryLoaderOptions): DirectoryLoaderApi => {
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusState>({
    level: "idle",
    message: "Ready",
  });
  // Keep a monotonic generation so backend scan cancellation survives webview reloads.
  const listGenerationRef = useRef(Date.now());
  // Track the most recent foreground load so background refreshes don't block the loader.
  const foregroundLoadIdRef = useRef(0);
  // Preserve the last query so refresh/navigation reuse the same sort + search.
  const lastQueryRef = useRef<ListDirQuery | null>(null);
  const lastQueryKeyRef = useRef("");
  const currentPathRef = useRef(currentPath);
  const dirCacheRef = useRef<Map<string, DirCacheEntry>>(new Map());

  const trimDirCache = useCallback((cache: Map<string, DirCacheEntry>) => {
    while (cache.size > DIR_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);

  const touchDirCache = useCallback(
    (cache: Map<string, DirCacheEntry>, key: string, entry: DirCacheEntry) => {
      cache.delete(key);
      cache.set(key, entry);
      trimDirCache(cache);
    },
    [trimDirCache],
  );

  const peekDirCache = useCallback((path: string, options?: ListDirOptions) => {
    const target = path.trim();
    if (!target) return null;
    // Read-only cache access so the UI can render from warm entries immediately.
    const query = resolveQuery(options, lastQueryRef.current);
    const queryKey = buildQueryKey(target, query);
    return dirCacheRef.current.get(queryKey) ?? null;
  }, []);

  const loadDir = useCallback(
    async (path: string, options?: LoadDirOptions) => {
      const target = path.trim();
      if (!target) return;

      const query = resolveQuery(options, lastQueryRef.current);
      const queryKey = buildQueryKey(target, query);
      const samePath =
        currentPathRef.current &&
        normalizePath(currentPathRef.current) === normalizePath(target);
      if (!options?.force && samePath && lastQueryKeyRef.current === queryKey) {
        return;
      }

      const previousQuery = lastQueryRef.current;
      const previousQueryKey = lastQueryKeyRef.current;
      lastQueryRef.current = query;
      lastQueryKeyRef.current = queryKey;

      log("loadDir start: %s", target);
      const currentLoad = loadIdRef.current + 1;
      loadIdRef.current = currentLoad;
      const listGeneration = Math.max(Date.now(), listGenerationRef.current + 1);
      listGenerationRef.current = listGeneration;
      const listStart = perf.enabled ? performance.now() : 0;

      const cachedEntry = dirCacheRef.current.get(queryKey) ?? null;
      const cacheHit = !options?.force ? cachedEntry : null;
      if (cacheHit) {
        touchDirCache(dirCacheRef.current, queryKey, cacheHit);
      }
      const showLoading = !options?.silent && !cacheHit;
      const currentForegroundLoad = showLoading ? foregroundLoadIdRef.current + 1 : 0;
      const cachedCount = cachedEntry?.totalCount ?? null;
      // Use fast mode only for name sorting. Non-name sorts (size/modified) run
      // as a single full pass to avoid split-order transitions between passes.
      const preferFast = cachedCount == null ? true : cachedCount > FAST_SORT_THRESHOLD;
      const useFast =
        options?.fast ??
        (query.sort.key === "name" &&
          !options?.silent &&
          !cacheHit &&
          preferFast);
      if (showLoading) {
        foregroundLoadIdRef.current = currentForegroundLoad;
        setLoading(true);
        setStatus({ level: "loading", message: `Loading ${target}` });
      } else if (cacheHit) {
        const cacheItems = normalizeEntriesOrder(cacheHit.entries, query.sort);
        touchDirCache(dirCacheRef.current, queryKey, {
          entries: cacheItems,
          totalCount: cacheHit.totalCount,
          parentPath: cacheHit.parentPath,
        });
        primeEntryMeta(cacheItems);
        setEntries(cacheItems);
        setTotalCount(cacheHit.totalCount);
        setCurrentPath(target);
        setParentPath(cacheHit.parentPath);
        setStatus({ level: "idle", message: "Ready" });
        setLoading(false);
      }

      try {
        const result = await listDirWithParent(target, {
          ...query,
          fast: useFast,
          generation: listGeneration,
        });
        if (loadIdRef.current !== currentLoad) return;
        const items = normalizeEntriesOrder(result.entries, query.sort);
        if (perf.enabled) {
          perf(
            "list_dir_with_parent: %s (%d of %d entries) in %dms",
            target,
            items.length,
            result.totalCount,
            Math.round(performance.now() - listStart),
          );
        }
        if (perf.enabled) {
          const metaStart = performance.now();
          primeEntryMeta(items);
          perf(
            "primeEntryMeta: %d entries in %dms",
            items.length,
            Math.round(performance.now() - metaStart),
          );
        } else {
          primeEntryMeta(items);
        }
        setEntries(items);
        setTotalCount(result.totalCount);
        setCurrentPath(target);
        setParentPath(result.parentPath);
        setStatus({ level: "idle", message: "Ready" });
        touchDirCache(dirCacheRef.current, queryKey, {
          entries: items,
          totalCount: result.totalCount,
          parentPath: result.parentPath,
        });
        log("loadDir done: %s (%d entries)", target, items.length);
      } catch (error) {
        if (loadIdRef.current !== currentLoad) return;
        lastQueryRef.current = previousQuery;
        lastQueryKeyRef.current = previousQueryKey;
        log("loadDir error: %s (%o)", target, error);
        reportError(
          "Couldn't open folder",
          `Failed to open ${target}: ${toMessage(error, "unknown error")}`,
        );
      } finally {
        if (showLoading && foregroundLoadIdRef.current === currentForegroundLoad) {
          setLoading(false);
        }
      }
    },
    [loadIdRef, log, perf, primeEntryMeta, reportError, touchDirCache],
  );

  // Light-weight refresh for small mutations (delete/rename/copy) to avoid double reloads.
  const refreshAfterChange = useCallback(async () => {
    const target = currentPathRef.current;
    if (!target) return;
    const lastQuery = lastQueryRef.current;
    const sort = lastQuery?.sort ?? DEFAULT_SORT;
    const search = lastQuery?.search ?? "";
    const allowFast = sort.key === "name";
    await loadDir(target, {
      sort,
      search,
      force: true,
      silent: true,
      fast: allowFast,
    });
  }, [loadDir]);

  // Clear the current view without hitting the filesystem.
  const clearDir = useCallback(
    (options?: { silent?: boolean }) => {
      const nextLoad = loadIdRef.current + 1;
      loadIdRef.current = nextLoad;
      foregroundLoadIdRef.current = nextLoad;
      lastQueryRef.current = null;
      lastQueryKeyRef.current = "";
      // Preserve cached directories so tab switches can restore instantly.
      primeEntryMeta([]);
      setEntries([]);
      setTotalCount(0);
      setCurrentPath("");
      setParentPath(null);
      setLoading(false);
      if (!options?.silent) {
        setStatus({ level: "idle", message: "Ready" });
      }
    },
    [loadIdRef, primeEntryMeta],
  );

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  return {
    currentPath,
    parentPath,
    entries,
    totalCount,
    loading,
    status,
    setLoading,
    setStatus,
    currentPathRef,
    loadDir,
    clearDir,
    peekDirCache,
    refreshAfterChange,
  };
};
