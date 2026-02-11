// Manages filesystem state, navigation, and status messaging.
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  getDrives,
  getPlaces,
  listDirWithParent,
  listDriveInfo,
  openPath,
  renameEntry,
  statEntries,
} from "@/api";
import {
  DEFAULT_SORT,
  makeDebug,
  normalizePath,
  sortEntries,
  tabLabel,
  toMessage,
} from "@/lib";
import {
  DIR_CACHE_LIMIT,
  FAST_SORT_THRESHOLD,
  META_CACHE_LIMIT,
  META_FLUSH_INTERVAL_MS,
  UNDO_STACK_LIMIT,
} from "@/constants";
import { usePromptStore } from "@/modules";
import type {
  DriveInfo,
  EntryMeta,
  FileEntry,
  ListDirOptions,
  Place,
  SortState,
} from "@/types";
import { useFileManagerCopy } from "./fileManagerCopy";
import { useFileManagerCreate } from "./fileManagerCreate";
import { useFileManagerDelete } from "./fileManagerDelete";
import { useFileManagerUndo } from "./fileManagerUndo";
import type { UndoAction } from "./fileManagerUndo";

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

type DirCacheEntry = {
  entries: FileEntry[];
  totalCount: number;
  parentPath: string | null;
};

type MetaRequestOptions = {
  defer?: boolean;
  // Force re-stat even when metadata is already cached.
  force?: boolean;
};

type RenameRequest = {
  path: string;
  nextName: string;
};

type RenameFailure = {
  path: string;
  nextName: string;
  message: string;
};

type RenameBatchResult = {
  renamed: Map<string, string>;
  failures: RenameFailure[];
};

// Undo action types live in fileManagerUndo.

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

// Canonicalize entry ordering in the UI layer so cached and refreshed snapshots
// follow the same deterministic order across tab switches.
const normalizeEntriesOrder = (items: FileEntry[], sort: SortState): FileEntry[] => {
  if (sort.key === "name") return items;
  if (items.length <= 1) return items;
  const metaMap = new Map<string, EntryMeta>();
  items.forEach((entry) => {
    const meta = toEntryMeta(entry);
    if (!meta) return;
    metaMap.set(entry.path, meta);
  });
  return sortEntries(items, metaMap, sort);
};

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
  // Suppress add/remove presence animation while undoing rename so entries stay in-place.
  const [suppressUndoPresence, setSuppressUndoPresence] = useState(false);
  const [status, setStatus] = useState<StatusState>({
    level: "idle",
    message: "Ready",
  });
  // Track latest request to avoid stale UI updates (and cancel older backend scans).
  const loadId = useRef(0);
  // Keep a monotonic generation so backend scan cancellation survives webview reloads.
  const listGenerationRef = useRef(Date.now());
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
  const dirCacheRef = useRef<Map<string, DirCacheEntry>>(new Map());
  const deleteInFlightRef = useRef(false);
  const copyInFlightRef = useRef(false);
  const renameInFlightRef = useRef(false);
  const createInFlightRef = useRef(false);
  // In-memory undo stack for the current session.
  const undoStackRef = useRef<UndoAction[]>([]);
  // Lazily resolved trash locations for soft deletes (keyed by drive root).
  const trashRootRef = useRef<Map<string, string>>(new Map());
  const homePathRef = useRef<string | null>(null);
  const homeDriveKeyRef = useRef<string | null>(null);

  const reportError = useCallback((title: string, message: string) => {
    usePromptStore.getState().showPrompt({
      title,
      content: message,
      confirmLabel: "OK",
      cancelLabel: null,
    });
    setStatus({ level: "idle", message: "Ready" });
  }, []);

  const pushUndo = useCallback((action: UndoAction) => {
    const stack = undoStackRef.current;
    stack.push(action);
    if (stack.length > UNDO_STACK_LIMIT) {
      stack.shift();
    }
  }, []);

  const canUndo = useCallback(() => undoStackRef.current.length > 0, []);

  const trimMetaCache = useCallback((cache: Map<string, EntryMeta>) => {
    while (cache.size > META_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);

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
      const listGeneration = Math.max(Date.now(), listGenerationRef.current + 1);
      listGenerationRef.current = listGeneration;
      const listStart = perf.enabled ? performance.now() : 0;

      const cachedEntry = dirCacheRef.current.get(queryKey) ?? null;
      const cacheHit = !options?.force ? cachedEntry : null;
      if (cacheHit) {
        touchDirCache(dirCacheRef.current, queryKey, cacheHit);
      }
      const showLoading = !options?.silent && !cacheHit;
      const currentForegroundLoad = showLoading ? foregroundLoadId.current + 1 : 0;
      const cachedCount = cachedEntry?.totalCount ?? null;
      // Use fast mode only for name sorting. Non-name sorts (size/modified) run
      // as a single full pass to avoid split-order transitions between passes.
      const preferFast =
        cachedCount == null ? true : cachedCount > FAST_SORT_THRESHOLD;
      const useFast =
        options?.fast ??
        (query.sort.key === "name" &&
          !options?.silent &&
          !cacheHit &&
          preferFast);
      if (showLoading) {
        foregroundLoadId.current = currentForegroundLoad;
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
        if (loadId.current !== currentLoad) return;
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
    [primeEntryMeta, touchDirCache],
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
        (path) =>
          !pendingMeta.current.has(path) && (options?.force ? true : !meta.has(path)),
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
      } catch (error) {
        if (perf.enabled) {
          perf("stat_entries failed: %o", error);
        }
        return [];
      } finally {
        batch.forEach((path) => pendingMeta.current.delete(path));
      }
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

  const { createFolderInView, createFileInView } = useFileManagerCreate({
    currentPathRef,
    createInFlightRef,
    refreshAfterChange,
  });

  const { duplicateEntriesInView, pasteEntriesInView } = useFileManagerCopy({
    currentPathRef,
    copyInFlightRef,
    refreshAfterChange,
    log,
  });

  const { deleteEntriesInView } = useFileManagerDelete({
    deleteInFlightRef,
    trashRootRef,
    homePathRef,
    homeDriveKeyRef,
    pushUndo,
    refreshAfterChange,
    log,
  });

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

  const performRenameRequests = useCallback(
    async (
      renames: RenameRequest[],
      options?: { recordUndo?: boolean; failureTitle?: string },
    ): Promise<RenameBatchResult | null> => {
      if (renameInFlightRef.current) return null;
      const nextRenames: RenameRequest[] = [];
      const seen = new Set<string>();
      renames.forEach((item) => {
        const path = item.path.trim();
        const nextName = item.nextName.trim();
        if (!path || !nextName) return;
        if (seen.has(path)) return;
        seen.add(path);
        nextRenames.push({ path, nextName });
      });
      if (nextRenames.length === 0) return null;
      renameInFlightRef.current = true;
      const failures: RenameFailure[] = [];
      const renamed = new Map<string, string>();
      try {
        for (const item of nextRenames) {
          try {
            const nextPath = await renameEntry(item.path, item.nextName);
            if (nextPath) {
              renamed.set(item.path, nextPath);
            }
          } catch (error) {
            failures.push({
              path: item.path,
              nextName: item.nextName,
              message: toMessage(error, "Failed to rename item."),
            });
          }
        }
        if (failures.length > 0) {
          const title = options?.failureTitle ?? "Rename completed with issues";
          const samples = failures.slice(0, 4).map((failure) => {
            const label = tabLabel(failure.path);
            return `${label} -> ${failure.nextName}\n${failure.message}`;
          });
          const suffix =
            failures.length > samples.length
              ? `\n...and ${failures.length - samples.length} more`
              : "";
          usePromptStore.getState().showPrompt({
            title,
            content: `${samples.join("\n\n")}${suffix}`,
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        if (renamed.size > 0) {
          await refreshAfterChange();
          if (options?.recordUndo !== false) {
            const undoEntries = Array.from(renamed).map(([from, to]) => ({
              from,
              to,
            }));
            pushUndo({ type: "rename", entries: undoEntries });
          }
        }
        return { renamed, failures };
      } finally {
        renameInFlightRef.current = false;
      }
    },
    [pushUndo, refreshAfterChange],
  );

  // Clear the current view without hitting the filesystem.
  const clearDir = useCallback(
    (options?: { silent?: boolean }) => {
      const nextLoad = loadId.current + 1;
      loadId.current = nextLoad;
      foregroundLoadId.current = nextLoad;
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
    [primeEntryMeta],
  );

  const renameEntryInView = useCallback(
    async (path: string, newName: string) => {
      const result = await performRenameRequests([{ path, nextName: newName }]);
      if (!result) return null;
      return result.renamed.get(path) ?? null;
    },
    [performRenameRequests],
  );

  // Batch rename with a single refresh + consolidated error reporting.
  const renameEntriesInView = useCallback(
    async (renames: RenameRequest[]): Promise<RenameBatchResult | null> =>
      performRenameRequests(renames),
    [performRenameRequests],
  );

  const { undoLastAction } = useFileManagerUndo({
    undoStackRef,
    renameInFlightRef,
    deleteInFlightRef,
    copyInFlightRef,
    onRenameUndoPresence: setSuppressUndoPresence,
    performRenameRequests,
    refreshAfterChange,
  });

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
    suppressUndoPresence,
    status,
    loadDir,
    clearDir,
    openEntry,
    refresh,
    peekDirCache,
    requestEntryMeta,
    flushEntryMeta,
    deleteEntries: deleteEntriesInView,
    duplicateEntries: duplicateEntriesInView,
    pasteEntries: pasteEntriesInView,
    createFolder: createFolderInView,
    createFile: createFileInView,
    renameEntry: renameEntryInView,
    renameEntries: renameEntriesInView,
    undo: undoLastAction,
    canUndo,
  };
}
