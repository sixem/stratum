// Manages filesystem state, navigation, and status messaging.
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  copyEntries,
  createFile,
  createFolder,
  deleteEntries as deleteEntriesApi,
  ensureDir,
  getDrives,
  getHome,
  getPlaces,
  listDirWithParent,
  listDriveInfo,
  openPath,
  renameEntry,
  statEntries,
  transferEntries,
} from "@/api";
import {
  DEFAULT_SORT,
  formatFailures,
  getParentPath,
  getPathName,
  makeDebug,
  normalizePath,
  tabLabel,
} from "@/lib";
import { usePromptStore, useTransferStore } from "@/modules";
import type {
  DriveInfo,
  DeleteReport,
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

type UndoRenameEntry = {
  from: string;
  to: string;
};

type UndoTrashEntry = {
  originalPath: string;
  trashPath: string;
};

type UndoAction =
  | { type: "rename"; entries: UndoRenameEntry[] }
  | { type: "trash"; entries: UndoTrashEntry[] };

const log = makeDebug("fs");
const perf = makeDebug("perf:fs");

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const TRASH_DIR_NAME = ".stratum-trash";
const UNDO_STACK_LIMIT = 20;

const joinPath = (base: string, name: string) => {
  const trimmed = base.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return name;
  return `${trimmed}\\${name}`;
};

// Normalize a path down to its volume root (drive letter or UNC share).
const getDriveKey = (path: string) => {
  const normalized = normalizePath(path);
  if (!normalized) return null;
  if (normalized.startsWith("\\\\")) {
    const parts = normalized.slice(2).split("\\");
    if (parts.length < 2) return null;
    return `\\\\${parts[0]}\\${parts[1]}`;
  }
  const driveMatch = /^[a-z]:/.exec(normalized);
  if (driveMatch) return driveMatch[0];
  if (normalized.startsWith("/")) return "/";
  return null;
};

const entryExists = (meta: EntryMeta | null | undefined) => {
  return Boolean(meta && (meta.size != null || meta.modified != null));
};

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
  const renameInFlightRef = useRef(false);
  const createInFlightRef = useRef(false);
  // In-memory undo stack for the current session.
  const undoStackRef = useRef<UndoAction[]>([]);
  // Lazily resolved trash location for soft deletes.
  const trashRootRef = useRef<string | null>(null);
  const startTransferJob = useTransferStore((state) => state.startJob);
  const completeTransferJob = useTransferStore((state) => state.completeJob);
  const failTransferJob = useTransferStore((state) => state.failJob);

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

  // Use a hidden-ish folder in the user's home as a simple trash bin.
  const resolveTrashRoot = useCallback(async () => {
    if (trashRootRef.current) return trashRootRef.current;
    const home = await getHome();
    if (!home) {
      throw new Error("Unable to resolve home directory for trash.");
    }
    const root = joinPath(home, TRASH_DIR_NAME);
    await ensureDir(root);
    trashRootRef.current = root;
    return root;
  }, []);

  const buildTrashBatchDir = useCallback((root: string) => {
    const nonce = Math.random().toString(36).slice(2, 8);
    return joinPath(root, `delete-${Date.now()}-${nonce}`);
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
      const listGeneration = Math.max(Date.now(), listGenerationRef.current + 1);
      listGenerationRef.current = listGeneration;
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
          generation: listGeneration,
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

  const createEntryInView = useCallback(
    async (parentPath: string, name: string, kind: "folder" | "file") => {
      if (createInFlightRef.current) return null;
      const parent = parentPath.trim();
      const trimmedName = name.trim();
      if (!parent || !trimmedName) return null;
      const targetPath = joinPath(parent, trimmedName);
      createInFlightRef.current = true;
      try {
        if (kind === "folder") {
          await createFolder(targetPath);
        } else {
          await createFile(targetPath);
        }
        const parentKey = normalizePath(parent);
        const currentKey = normalizePath(currentPathRef.current);
        if (parentKey && currentKey && parentKey === currentKey) {
          await refreshAfterChange();
        }
        return targetPath;
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : `Failed to create ${kind}.`;
        usePromptStore.getState().showPrompt({
          title: kind === "folder" ? "Create folder failed" : "Create file failed",
          content: message,
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return null;
      } finally {
        createInFlightRef.current = false;
      }
    },
    [refreshAfterChange],
  );

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
    async (paths: string[]): Promise<DeleteReport | null> => {
      if (deleteInFlightRef.current) return null;
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;
      log("delete entries (trash): %d items", unique.length);
      deleteInFlightRef.current = true;
      try {
        let trashRoot: string | null = null;
        let trashRootError: string | null = null;
        try {
          trashRoot = await resolveTrashRoot();
        } catch (error) {
          trashRootError = toMessage(error, "Trash is unavailable.");
        }

        const trashKey = trashRoot ? getDriveKey(trashRoot) : null;
        const trashCandidates: string[] = [];
        const crossDrive: string[] = [];

        if (trashRoot) {
          unique.forEach((path) => {
            const pathKey = trashKey ? getDriveKey(path) : null;
            if (trashKey && pathKey && pathKey !== trashKey) {
              crossDrive.push(path);
              return;
            }
            trashCandidates.push(path);
          });
        } else {
          crossDrive.push(...unique);
        }

        let report: Awaited<ReturnType<typeof transferEntries>> | null = null;
        const moved: UndoTrashEntry[] = [];
        const remaining = new Set<string>();

        if (trashRoot && trashCandidates.length > 0) {
          // Move items into a per-delete batch folder so undo can restore them.
          const batchDir = buildTrashBatchDir(trashRoot);
          await ensureDir(batchDir);

          report = await transferEntries(trashCandidates, batchDir, {
            mode: "move",
            overwrite: false,
          });

          // Verify what actually disappeared from the source path before we mark it as trashed.
          const originalMeta = await statEntries(trashCandidates);
          originalMeta.forEach((meta, index) => {
            const path = trashCandidates[index] ?? "";
            if (!path) return;
            if (entryExists(meta)) {
              remaining.add(path);
              return;
            }
            moved.push({
              originalPath: path,
              trashPath: joinPath(batchDir, getPathName(path)),
            });
          });

          if (moved.length > 0) {
            pushUndo({ type: "trash", entries: moved });
            await refreshAfterChange();
          }
        }

        crossDrive.forEach((path) => remaining.add(path));
        const remainingPaths = Array.from(remaining);
        const transferFailures = report?.failures ?? [];

        if (remainingPaths.length > 0) {
          const reasons: string[] = [];
          if (!trashRoot) {
            reasons.push(trashRootError ?? "Trash is unavailable.");
          } else if (crossDrive.length > 0) {
            reasons.push(
              "Some items are on a different drive than the Trash (including network drives), so they can't be moved there.",
            );
          }
          if (transferFailures.length > 0) {
            reasons.push(
              `Move to Trash failed for some items:\n${formatFailures(transferFailures)}`,
            );
          }
          if (reasons.length === 0) {
            reasons.push("Some items could not be moved to the Trash.");
          }
          const countLabel =
            remainingPaths.length === 1
              ? "this item"
              : `${remainingPaths.length} items`;
          return await new Promise<DeleteReport>((resolve) => {
            usePromptStore.getState().showPrompt({
              title: "Couldn't move items to Trash",
              content: `${reasons.join("\n\n")}\n\nDelete ${countLabel} permanently instead? This cannot be undone.`,
              confirmLabel: "Delete permanently",
              cancelLabel: "Cancel",
              onConfirm: async () => {
                let hardReport = null;
                try {
                  hardReport = await deleteEntriesApi(remainingPaths);
                } catch (error) {
                  usePromptStore.getState().showPrompt({
                    title: "Delete failed",
                    content: toMessage(error, "Failed to delete selected items."),
                    confirmLabel: "OK",
                    cancelLabel: null,
                  });
                  resolve({
                    deleted: moved.length,
                    skipped: Math.max(0, unique.length - moved.length),
                    failures: transferFailures,
                  });
                  return;
                }
                if (hardReport.failures.length > 0) {
                  usePromptStore.getState().showPrompt({
                    title: "Delete completed with issues",
                    content: formatFailures(hardReport.failures),
                    confirmLabel: "OK",
                    cancelLabel: null,
                  });
                }
                if (hardReport.deleted > 0) {
                  await refreshAfterChange();
                }
                resolve({
                  deleted: moved.length + hardReport.deleted,
                  skipped: Math.max(
                    0,
                    unique.length - moved.length - hardReport.deleted,
                  ),
                  failures: [...transferFailures, ...hardReport.failures],
                });
              },
              onCancel: () => {
                resolve({
                  deleted: moved.length,
                  skipped: Math.max(0, unique.length - moved.length),
                  failures: transferFailures,
                });
              },
            });
          });
        }

        if (transferFailures.length > 0) {
          usePromptStore.getState().showPrompt({
            title: "Delete completed with issues",
            content: formatFailures(transferFailures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        return {
          deleted: moved.length,
          skipped: Math.max(0, unique.length - moved.length),
          failures: transferFailures,
        };
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
    [buildTrashBatchDir, pushUndo, refreshAfterChange, resolveTrashRoot],
  );

  const restoreTrashedEntries = useCallback(
    async (entries: UndoTrashEntry[]) => {
      if (entries.length === 0) {
        return { restored: 0, remaining: [] };
      }
      const originals = entries.map((entry) => entry.originalPath);
      const existingMeta = await statEntries(originals);
      const existing = new Set<string>();
      existingMeta.forEach((meta, index) => {
        const exists = meta.size != null || meta.modified != null;
        if (exists) {
          existing.add(originals[index] ?? "");
        }
      });

      const grouped = new Map<string, string[]>();
      const failures: string[] = [];
      entries.forEach((entry) => {
        if (!entry.originalPath || !entry.trashPath) return;
        if (existing.has(entry.originalPath)) {
          failures.push(`${entry.originalPath}: destination already exists`);
          return;
        }
        const parent = getParentPath(entry.originalPath);
        if (!parent) {
          failures.push(`${entry.originalPath}: missing parent folder`);
          return;
        }
        const list = grouped.get(parent) ?? [];
        list.push(entry.trashPath);
        grouped.set(parent, list);
      });

      let restored = 0;
      for (const [destination, paths] of grouped) {
        const report = await transferEntries(paths, destination, {
          mode: "move",
          overwrite: false,
        });
        restored += report.moved;
        if (report.failures.length > 0) {
          failures.push(...report.failures);
        }
      }

      const trashMeta = await statEntries(entries.map((entry) => entry.trashPath));
      const remaining: UndoTrashEntry[] = [];
      trashMeta.forEach((meta, index) => {
        const exists = meta.size != null || meta.modified != null;
        if (!exists) return;
        const entry = entries[index];
        if (entry) {
          remaining.push(entry);
        }
      });

      if (failures.length > 0) {
        usePromptStore.getState().showPrompt({
          title: "Undo completed with issues",
          content: formatFailures(failures),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      }

      if (restored > 0) {
        await refreshAfterChange();
      }

      return { restored, remaining };
    },
    [refreshAfterChange],
  );

  const undoLastAction = useCallback(async () => {
    if (
      renameInFlightRef.current ||
      deleteInFlightRef.current ||
      copyInFlightRef.current
    ) {
      return false;
    }
    // Pop the last action so undo behaves like standard stacks.
    const action = undoStackRef.current.pop();
    if (!action) return false;

    if (action.type === "rename") {
      const requests: RenameRequest[] = action.entries
        .map((entry) => ({
          path: entry.to,
          nextName: getPathName(entry.from),
        }))
        .filter((item) => item.path && item.nextName);
      const result = await performRenameRequests(requests, {
        recordUndo: false,
        failureTitle: "Undo completed with issues",
      });
      if (!result) {
        undoStackRef.current.push(action);
        return false;
      }
      if (result.renamed.size === 0) {
        undoStackRef.current.push(action);
        return false;
      }
      const remaining = action.entries.filter(
        (entry) => !result.renamed.has(entry.to),
      );
      if (remaining.length > 0) {
        undoStackRef.current.push({ type: "rename", entries: remaining });
      }
      return true;
    }

    if (action.type === "trash") {
      const { restored, remaining } = await restoreTrashedEntries(action.entries);
      if (remaining.length > 0) {
        undoStackRef.current.push({ type: "trash", entries: remaining });
      }
      return restored > 0;
    }

    return false;
  }, [performRenameRequests, restoreTrashedEntries]);

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
      const job = startTransferJob({
        label: operationLabel,
        total: unique.length,
        items: unique,
      });
      try {
        const report = await copyEntries(unique, target, job.id);
        if (report.failures.length > 0) {
          usePromptStore.getState().showPrompt({
            title: `${operationLabel} completed with issues`,
            content: formatFailures(report.failures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        if (report.copied > 0 && currentPathRef.current.trim() === target) {
          await refreshAfterChange();
        }
        completeTransferJob(job.id, {
          copied: report.copied,
          skipped: report.skipped,
          failures: report.failures.length,
        });
        return report;
      } catch (error) {
        failTransferJob(job.id);
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
    [completeTransferJob, failTransferJob, refreshAfterChange, startTransferJob],
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

  const createFolderInView = useCallback(
    async (parentPath: string, name: string) =>
      createEntryInView(parentPath, name, "folder"),
    [createEntryInView],
  );

  const createFileInView = useCallback(
    async (parentPath: string, name: string) =>
      createEntryInView(parentPath, name, "file"),
    [createEntryInView],
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
    createFolder: createFolderInView,
    createFile: createFileInView,
    renameEntry: renameEntryInView,
    renameEntries: renameEntriesInView,
    undo: undoLastAction,
    canUndo,
  };
}
