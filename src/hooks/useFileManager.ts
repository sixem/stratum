// Manages filesystem state, navigation, and status messaging.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  copyEntries,
  deleteEntries,
  getDrives,
  getHome,
  getPlaces,
  listDir,
  listDriveInfo,
  openPath,
  parentDir,
  statEntries,
} from "@/api";
import { formatFailures } from "@/lib";
import { usePromptStore } from "@/modules";
import type { DriveInfo, EntryMeta, FileEntry, Place } from "@/types";

type StatusLevel = "idle" | "loading" | "error";

type StatusState = {
  level: StatusLevel;
  message: string;
};

const META_CACHE_LIMIT = 60000;

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
  const [places, setPlaces] = useState<Place[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [driveInfo, setDriveInfo] = useState<DriveInfo[]>([]);
  const [entryMeta, setEntryMeta] = useState<Map<string, EntryMeta>>(new Map());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusState>({
    level: "idle",
    message: "Ready",
  });
  // Track latest request to avoid stale UI updates.
  const loadId = useRef(0);
  const pendingMeta = useRef(new Set<string>());
  const entryMetaRef = useRef(entryMeta);
  const metaCacheRef = useRef<Map<string, EntryMeta>>(new Map());
  const currentPathRef = useRef(currentPath);
  const deleteInFlightRef = useRef(false);
  const copyInFlightRef = useRef(false);

  const trimMetaCache = useCallback((cache: Map<string, EntryMeta>) => {
    while (cache.size > META_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);
  const reportError = useCallback((title: string, message: string) => {
    usePromptStore.getState().showPrompt({
      title,
      content: message,
      confirmLabel: "OK",
      cancelLabel: null,
    });
    setStatus({ level: "idle", message: "Ready" });
  }, []);

  const primeEntryMeta = useCallback((items: FileEntry[]) => {
    pendingMeta.current.clear();
    const cache = metaCacheRef.current;
    const next = new Map<string, EntryMeta>();
    items.forEach((entry) => {
      const cached = cache.get(entry.path);
      if (!cached) return;
      cache.delete(entry.path);
      cache.set(entry.path, cached);
      next.set(entry.path, cached);
    });
    trimMetaCache(cache);
    entryMetaRef.current = next;
    setEntryMeta(next);
  }, [trimMetaCache]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const loadDir = useCallback(async (path: string) => {
    const target = path.trim();
    if (!target) return;

    const currentLoad = loadId.current + 1;
    loadId.current = currentLoad;

    setLoading(true);
    setStatus({ level: "loading", message: `Loading ${target}` });

    try {
      const [items, parent] = await Promise.all([listDir(target), parentDir(target)]);
      if (loadId.current !== currentLoad) return;
      primeEntryMeta(items);
      setEntries(items);
      setCurrentPath(target);
      setParentPath(parent);
      setStatus({ level: "idle", message: "Ready" });
    } catch (error) {
      if (loadId.current !== currentLoad) return;
      reportError(
        "Couldn't open folder",
        `Failed to open ${target}: ${toMessage(error, "unknown error")}`,
      );
    } finally {
      if (loadId.current === currentLoad) {
        setLoading(false);
      }
    }
  }, [primeEntryMeta]);

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
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const unique = new Set(paths.map((path) => path.trim()).filter(Boolean));
      const meta = entryMetaRef.current;
      const missing = Array.from(unique).filter(
        (path) => !meta.has(path) && !pendingMeta.current.has(path),
      );
      if (missing.length === 0) return;

      const batch = missing.slice(0, 120);
      batch.forEach((path) => pendingMeta.current.add(path));
      const currentLoad = loadId.current;

      try {
        const results = await statEntries(batch);
        if (loadId.current !== currentLoad) return;
        if (results.length === 0) return;
        const cache = metaCacheRef.current;
        setEntryMeta((prev) => {
          const next = new Map(prev);
          results.forEach((meta) => {
            cache.delete(meta.path);
            cache.set(meta.path, meta);
            next.set(meta.path, meta);
          });
          trimMetaCache(cache);
          entryMetaRef.current = next;
          return next;
        });
      } finally {
        batch.forEach((path) => pendingMeta.current.delete(path));
      }
    },
    [trimMetaCache],
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
    if (!currentPath) return;
    await Promise.all([loadDir(currentPath), refreshDriveInfo()]);
  }, [currentPath, loadDir, refreshDriveInfo]);

  const deleteEntriesInView = useCallback(
    async (paths: string[]) => {
      if (deleteInFlightRef.current) return null;
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;
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

  const duplicateEntriesInView = useCallback(
    async (paths: string[]) => {
      if (copyInFlightRef.current) return null;
      const destination = currentPathRef.current.trim();
      if (!destination) return null;
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;
      copyInFlightRef.current = true;
      try {
        const report = await copyEntries(unique, destination);
        if (report.failures.length > 0) {
          usePromptStore.getState().showPrompt({
            title: "Duplicate completed with issues",
            content: formatFailures(report.failures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        if (report.copied > 0) {
          await refresh();
        }
        return report;
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Failed to duplicate selected items.";
        usePromptStore.getState().showPrompt({
          title: "Duplicate failed",
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

  useEffect(() => {
    let active = true;

    const init = async () => {
      setLoading(true);
      setStatus({ level: "loading", message: "Loading locations" });

      try {
        const [homeResult, placesResult, drivesResult, driveInfoResult] =
          await Promise.allSettled([
            getHome(),
            getPlaces(),
            getDrives(),
            listDriveInfo(),
          ]);
        const home = homeResult.status === "fulfilled" ? homeResult.value : null;
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

        const startPath = home ?? placeList[0]?.path ?? resolvedDrives[0];
        if (startPath) {
          await loadDir(startPath);
        } else {
          reportError("Couldn't start", "No start folder available.");
          setLoading(false);
        }
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
  }, [loadDir]);

  return {
    currentPath,
    parentPath,
    entries,
    places,
    drives,
    driveInfo,
    entryMeta,
    loading,
    status,
    loadDir,
    openEntry,
    refresh,
    requestEntryMeta,
    deleteEntries: deleteEntriesInView,
    duplicateEntries: duplicateEntriesInView,
  };
}
