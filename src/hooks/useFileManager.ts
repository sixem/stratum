// Manages filesystem state, navigation, and status messaging.
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  copyEntries,
  deleteEntries,
  getDrives,
  getPlaces,
  listDirWithParent,
  listDriveInfo,
  openPath,
  statEntries,
} from "@/api";
import { DEFAULT_SORT, formatFailures, makeDebug, normalizePath } from "@/lib";
import { usePromptStore } from "@/modules";
import type {
  DriveInfo,
  EntryMeta,
  FileEntry,
  ListDirOptions,
  Place,
  SortState,
} from "@/types";

type StatusLevel = "idle" | "loading" | "error";

type StatusState = {
  level: StatusLevel;
  message: string;
};

type ListDirQuery = {
  sort: SortState;
  search: string;
};

type LoadDirOptions = ListDirOptions & {
  force?: boolean;
  silent?: boolean;
};

const META_CACHE_LIMIT = 60000;
const META_FLUSH_INTERVAL_MS = 220;
// Avoid fast + full reloads for small folders where a full sort is cheap.
const FAST_SORT_THRESHOLD = 800;

type MetaRequestOptions = {
  defer?: boolean;
};

const log = makeDebug("fs");
const perf = makeDebug("perf:fs");

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const buildQueryKey = (path: string, query: ListDirQuery) => {
  const normalizedPath = normalizePath(path);
  const normalizedSearch = normalizeSearch(query.search);
  return `${normalizedPath}:${query.sort.key}:${query.sort.dir}:${normalizedSearch}`;
};

const resolveQuery = (options?: LoadDirOptions, last?: ListDirQuery | null): ListDirQuery => {
  return {
    sort: options?.sort ?? last?.sort ?? DEFAULT_SORT,
    search: options?.search ?? last?.search ?? "",
  };
};

const toEntryMeta = (entry: FileEntry): EntryMeta | null => {
  if (entry.size == null && entry.modified == null) return null;
  return {
    path: entry.path,
    size: entry.size ?? null,
    modified: entry.modified ?? null,
  };
};

function toMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
    const cause = record.cause;
    if (typeof cause === "string" && cause.trim().length > 0) {
      return cause;
    }
    const nested = record.error;
    if (typeof nested === "string" && nested.trim().length > 0) {
      return nested;
    }
    try {
      return JSON.stringify(error);
    } catch {
      // Ignore serialization errors.
    }
  }
  return fallback;
}

export function useFileManager() {
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [places, setPlaces] = useState<Place[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [driveInfo, setDriveInfo] = useState<DriveInfo[]>([]);
  const [entryMeta, setEntryMeta] = useState<Map<string, EntryMeta>>(new Map());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusState>({
    level: "idle",
    message: "Ready",
  });
  // Track latest request to avoid stale UI updates (and cancel older backend scans).
  const loadId = useRef(0);
  // Track the most recent foreground load so background refreshes don't block the loader.
  const foregroundLoadId = useRef(0);
  // Preserve the last query so refresh/navigation reuse the same sort + search.
  const lastQueryRef = useRef<ListDirQuery | null>(null);
  const lastQueryKeyRef = useRef("");
  const pendingMeta = useRef(new Set<string>());
  const entryMetaRef = useRef(entryMeta);
  const metaCacheRef = useRef<Map<string, EntryMeta>>(new Map());
  const metaDirtyRef = useRef(false);
  const metaFlushTimerRef = useRef<number | null>(null);
  const currentPathRef = useRef(currentPath);
  const dirCacheRef = useRef(
    new Map<
      string,
      {
        entries: FileEntry[];
        totalCount: number;
        parentPath: string | null;
      }
    >(),
  );
  const deleteInFlightRef = useRef(false);
  const copyInFlightRef = useRef(false);

  const reportError = useCallback((title: string, message: string) => {
    usePromptStore.getState().showPrompt({
      title,
      content: message,
      confirmLabel: "OK",
      cancelLabel: null,
    });
    setStatus({ level: "idle", message: "Ready" });
  }, []);
  const trimMetaCache = useCallback((cache: Map<string, EntryMeta>) => {
    while (cache.size > META_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);

  // Batch entry metadata updates to avoid a React commit on every small batch.
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

  const primeEntryMeta = useCallback((items: FileEntry[]) => {
    resetMetaFlush();
    pendingMeta.current.clear();
    const cache = metaCacheRef.current;
    const next = new Map<string, EntryMeta>();
    items.forEach((entry) => {
      const fromEntry = toEntryMeta(entry);
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
  }, [resetMetaFlush, trimMetaCache]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    return () => {
      resetMetaFlush();
    };
  }, [resetMetaFlush]);

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
      const currentLoad = loadId.current + 1;
      loadId.current = currentLoad;
      const listStart = perf.enabled ? performance.now() : 0;

      const cachedEntry = dirCacheRef.current.get(queryKey) ?? null;
      const cacheHit = !options?.force ? cachedEntry : null;
      const showLoading = !options?.silent && !cacheHit;
      const currentForegroundLoad = showLoading ? foregroundLoadId.current + 1 : 0;
      const cachedCount = cachedEntry?.totalCount ?? null;
      // Default to the fast path only when the last known folder size is large.
      const preferFast =
        cachedCount == null ? true : cachedCount > FAST_SORT_THRESHOLD;
      const useFast =
        options?.fast ??
        (query.sort.key !== "name" &&
          !options?.silent &&
          !cacheHit &&
          preferFast);
      if (showLoading) {
        foregroundLoadId.current = currentForegroundLoad;
        setLoading(true);
        setStatus({ level: "loading", message: `Loading ${target}` });
      } else if (cacheHit) {
        primeEntryMeta(cacheHit.entries);
        setEntries(cacheHit.entries);
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
          generation: currentLoad,
        });
        if (loadId.current !== currentLoad) return;
        const items = result.entries;
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
        dirCacheRef.current.set(queryKey, {
          entries: items,
          totalCount: result.totalCount,
          parentPath: result.parentPath,
        });
        log("loadDir done: %s (%d entries)", target, items.length);
        if (useFast && query.sort.key !== "name" && loadId.current === currentLoad) {
          void loadDir(target, {
            sort: query.sort,
            search: query.search,
            silent: true,
            force: true,
            fast: false,
          });
        }
      } catch (error) {
        if (loadId.current !== currentLoad) return;
        lastQueryRef.current = previousQuery;
        lastQueryKeyRef.current = previousQueryKey;
        log("loadDir error: %s (%o)", target, error);
        reportError(
          "Couldn't open folder",
          `Failed to open ${target}: ${toMessage(error, "unknown error")}`,
        );
      } finally {
        if (showLoading && foregroundLoadId.current === currentForegroundLoad) {
          setLoading(false);
        }
      }
    },
    [primeEntryMeta],
  );

  const openEntry = useCallback(async (path: string) => {
    const target = path.trim();
    if (!target) return;
    try {
      await openPath(target);
    } catch (error) {
      reportError(
        "Couldn't open item",
        `Failed to open ${target}: ${toMessage(error, "unknown error")}`,
      );
    }
  }, [reportError]);

  const requestEntryMeta = useCallback(
    async (paths: string[], options?: MetaRequestOptions): Promise<EntryMeta[]> => {
      if (paths.length === 0) return [];
      const unique = new Set(paths.map((path) => path.trim()).filter(Boolean));
      const meta = entryMetaRef.current;
      const missing = Array.from(unique).filter(
        (path) => !meta.has(path) && !pendingMeta.current.has(path),
      );
      if (missing.length === 0) return [];

      const batch = missing.slice(0, 120);
      batch.forEach((path) => pendingMeta.current.add(path));
      const currentLoad = loadId.current;
      if (perf.enabled) {
        perf("stat_entries queued: batch=%d missing=%d", batch.length, missing.length);
      }

      try {
        const start = perf.enabled ? performance.now() : 0;
        const results = await statEntries(batch);
        if (loadId.current !== currentLoad) return [];
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
        results.forEach((meta) => {
          cache.delete(meta.path);
          cache.set(meta.path, meta);
          next.set(meta.path, meta);
        });
        trimMetaCache(cache);
        entryMetaRef.current = next;
        metaDirtyRef.current = true;
        if (!options?.defer) {
          scheduleMetaFlush();
        }
        return results;
      } finally {
        batch.forEach((path) => pendingMeta.current.delete(path));
      }
      return [];
    },
    [scheduleMetaFlush, trimMetaCache],
  );

  const refreshDriveInfo = useCallback(async () => {
    try {
      const info = await listDriveInfo();
      setDriveInfo(info);
    } catch {
      // Ignore drive info errors; we'll keep the last known state.
    }
  }, []);

  const refresh = useCallback(async () => {
    const target = currentPathRef.current;
    if (!target) return;
    log("refresh start: %s", target);
    const start = perf.enabled ? performance.now() : 0;
    await Promise.all([loadDir(target, { force: true }), refreshDriveInfo()]);
    if (perf.enabled) {
      perf(
        "refresh complete: %s in %dms",
        target,
        Math.round(performance.now() - start),
      );
    }
  }, [loadDir, refreshDriveInfo]);

  // Clear the current view without hitting the filesystem.
  const clearDir = useCallback(
    (options?: { silent?: boolean }) => {
      const nextLoad = loadId.current + 1;
      loadId.current = nextLoad;
      foregroundLoadId.current = nextLoad;
      lastQueryRef.current = null;
      lastQueryKeyRef.current = "";
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
    [primeEntryMeta],
  );

  const deleteEntriesInView = useCallback(
    async (paths: string[]) => {
      if (deleteInFlightRef.current) return null;
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;
      log("delete entries: %d items", unique.length);
      deleteInFlightRef.current = true;
      try {
        const report = await deleteEntries(unique);
        if (report.failures.length > 0) {
          usePromptStore.getState().showPrompt({
            title: "Delete completed with issues",
            content: formatFailures(report.failures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        if (report.deleted > 0) {
          await refresh();
        }
        return report;
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Failed to delete selected items.";
        usePromptStore.getState().showPrompt({
          title: "Delete failed",
          content: message,
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return null;
      } finally {
        deleteInFlightRef.current = false;
      }
    },
    [refresh],
  );

  // Shared copy pipeline for duplicate/paste actions.
  const runCopyOperation = useCallback(
    async (paths: string[], destination: string, operationLabel: string) => {
      if (copyInFlightRef.current) return null;
      const target = destination.trim();
      if (!target) return null;
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;
      log("%s entries: %d items -> %s", operationLabel, unique.length, target);
      copyInFlightRef.current = true;
      try {
        const report = await copyEntries(unique, target);
        if (report.failures.length > 0) {
          usePromptStore.getState().showPrompt({
            title: `${operationLabel} completed with issues`,
            content: formatFailures(report.failures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        if (report.copied > 0 && currentPathRef.current.trim() === target) {
          await refresh();
        }
        return report;
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : `Failed to ${operationLabel.toLowerCase()} selected items.`;
        usePromptStore.getState().showPrompt({
          title: `${operationLabel} failed`,
          content: message,
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return null;
      } finally {
        copyInFlightRef.current = false;
      }
    },
    [refresh],
  );

  const duplicateEntriesInView = useCallback(
    async (paths: string[]) =>
      runCopyOperation(paths, currentPathRef.current, "Duplicate"),
    [runCopyOperation],
  );

  const pasteEntriesInView = useCallback(
    async (paths: string[], destination?: string) => {
      const target = destination ?? currentPathRef.current;
      return runCopyOperation(paths, target, "Paste");
    },
    [runCopyOperation],
  );

  useEffect(() => {
    let active = true;

    const init = async () => {
      setLoading(true);
      setStatus({ level: "loading", message: "Loading locations" });

      try {
        const [placesResult, drivesResult, driveInfoResult] = await Promise.allSettled([
          getPlaces(),
          getDrives(),
          listDriveInfo(),
        ]);
        const placeList = placesResult.status === "fulfilled" ? placesResult.value : [];
        const driveList = drivesResult.status === "fulfilled" ? drivesResult.value : [];
        const driveInfoList =
          driveInfoResult.status === "fulfilled" ? driveInfoResult.value : [];
        const resolvedDrives =
          driveList.length > 0 ? driveList : driveInfoList.map((item) => item.path);
        if (!active) return;
        setPlaces(placeList);
        setDriveInfo(driveInfoList);
        setDrives(resolvedDrives);

        if (!active) return;
        setStatus({ level: "idle", message: "Ready" });
        setLoading(false);
      } catch (error) {
        if (!active) return;
        reportError(
          "Couldn't start",
          `Failed to load places: ${toMessage(error, "unknown error")}`,
        );
        setLoading(false);
      }
    };

    init();
    return () => {
      active = false;
    };
  }, []);

  return {
    currentPath,
    parentPath,
    entries,
    totalCount,
    places,
    drives,
    driveInfo,
    entryMeta,
    loading,
    status,
    loadDir,
    clearDir,
    openEntry,
    refresh,
    requestEntryMeta,
    flushEntryMeta,
    deleteEntries: deleteEntriesInView,
    duplicateEntries: duplicateEntriesInView,
    pasteEntries: pasteEntriesInView,
  };
}
