// Manages delayed tab-hover submenu state for drag-drop destinations.
import { useCallback, useEffect, useRef, useState } from "react";
import { listDir } from "@/api";
import type { DropTarget, DropTargetSubmenuItem, TabDropSubmenuState } from "@/lib";
import { getParentPath, getPathName, normalizePath } from "@/lib";
import {
  getDirectoryChildVersion,
  useDirectoryChildStateRevision,
} from "@/modules";

type UseTabDropSubmenuOptions = {
  enabled: boolean;
  includeSubfolders: boolean;
  includeParent: boolean;
};

const TAB_SUBMENU_HOVER_DELAY_MS = 320;
const TAB_SUBMENU_CLOSE_DELAY_MS = 110;
const TAB_SUBMENU_CACHE_LIMIT = 24;

const EMPTY_SUBMENU_STATE: TabDropSubmenuState = {
  hostTabId: null,
  hostPath: null,
  items: [],
  loading: false,
};

type CachedSubmenuEntry = {
  items: DropTargetSubmenuItem[];
  version: number;
};

const sortSubmenuItems = (items: DropTargetSubmenuItem[]) =>
  [...items].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

const toSubmenuItems = (entries: { isDir: boolean; name: string; path: string }[]) =>
  sortSubmenuItems(
    entries
      .filter((entry) => entry.isDir)
      .map((entry) => ({
        name: getPathName(entry.path) || entry.name,
        path: entry.path,
      })),
  );

const itemBelongsToSubmenu = (items: DropTargetSubmenuItem[], path: string) => {
  const pathKey = normalizePath(path);
  return items.some((item) => normalizePath(item.path) === pathKey);
};

export const useTabDropSubmenu = ({ enabled, includeSubfolders, includeParent }: UseTabDropSubmenuOptions) => {
  const directoryChildRevision = useDirectoryChildStateRevision();
  const [submenu, setSubmenu] = useState<TabDropSubmenuState>(EMPTY_SUBMENU_STATE);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const activeHostKeyRef = useRef<string | null>(null);
  const pendingHostRef = useRef<{ tabId: string; path: string } | null>(null);
  const requestIdRef = useRef(0);
  const cacheRef = useRef<Map<string, CachedSubmenuEntry>>(new Map());

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current == null) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current == null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const touchCache = useCallback((key: string, entry: CachedSubmenuEntry) => {
    cacheRef.current.delete(key);
    cacheRef.current.set(key, entry);
    while (cacheRef.current.size > TAB_SUBMENU_CACHE_LIMIT) {
      const oldestKey = cacheRef.current.keys().next().value;
      if (!oldestKey) break;
      cacheRef.current.delete(oldestKey);
    }
  }, []);

  const closeSubmenu = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    pendingHostRef.current = null;
    activeHostKeyRef.current = null;
    requestIdRef.current += 1;
    setSubmenu((previous) => {
      if (
        previous.hostTabId == null &&
        previous.hostPath == null &&
        previous.items.length === 0 &&
        !previous.loading
      ) {
        return previous;
      }
      return EMPTY_SUBMENU_STATE;
    });
  }, [clearCloseTimer, clearOpenTimer]);

  const openSubmenu = useCallback(
    async (tabId: string, path: string) => {
      const trimmedPath = path.trim();
      if (!enabled || !tabId || !trimmedPath) {
        closeSubmenu();
        return;
      }

      clearOpenTimer();
      clearCloseTimer();
      pendingHostRef.current = null;

      const cacheKey = normalizePath(trimmedPath);
      const hostKey = `${tabId}\u0000${cacheKey}`;
      activeHostKeyRef.current = hostKey;
      const requestId = ++requestIdRef.current;
      const parentPath = includeParent ? getParentPath(trimmedPath) : null;
      const parent: DropTargetSubmenuItem | null = parentPath && normalizePath(parentPath) !== cacheKey
        ? { path: parentPath, name: getPathName(parentPath) || parentPath, parent: true }
        : null;
      // The parent is known immediately and is independent of the child cache.
      const showSubmenu = (children: DropTargetSubmenuItem[], loading = false) => {
        const items = parent ? [parent, ...children] : children;
        setSubmenu(items.length || loading
          ? { hostTabId: tabId, hostPath: trimmedPath, items, loading }
          : EMPTY_SUBMENU_STATE);
      };
      if (!includeSubfolders) {
        showSubmenu([]);
        return;
      }

      const currentVersion = getDirectoryChildVersion(trimmedPath);
      const cachedEntry = cacheRef.current.get(cacheKey) ?? null;
      if (cachedEntry && cachedEntry.version === currentVersion) {
        touchCache(cacheKey, cachedEntry);
        showSubmenu(cachedEntry.items);
        return;
      }

      showSubmenu([], true);

      let version = currentVersion;
      while (true) {
        const result = await listDir(trimmedPath, {
          sort: { key: "name", dir: "asc" },
          fast: true,
        }).catch(() => null);
        if (requestIdRef.current !== requestId) return;
        if (activeHostKeyRef.current !== hostKey) return;

        const latestVersion = getDirectoryChildVersion(trimmedPath);
        if (version !== latestVersion) {
          // A file operation changed this folder while the listing was in flight.
          version = latestVersion;
          continue;
        }
        const items = result ? toSubmenuItems(result.entries) : [];
        touchCache(cacheKey, { items, version });
        showSubmenu(items);
        return;
      }
    },
    [clearCloseTimer, clearOpenTimer, closeSubmenu, enabled, includeParent, includeSubfolders, touchCache],
  );

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    pendingHostRef.current = null;
    if (submenu.hostTabId == null || closeTimerRef.current != null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      closeSubmenu();
    }, TAB_SUBMENU_CLOSE_DELAY_MS);
  }, [clearOpenTimer, closeSubmenu, submenu.hostTabId]);

  const updateTarget = useCallback(
    (target: DropTarget | null) => {
      if (!enabled) {
        closeSubmenu();
        return;
      }

      if (!target) {
        scheduleClose();
        return;
      }

      if (target.kind === "tab-destination" || target.kind === "tab-submenu") {
        if (
          !target.tabId ||
          target.tabId !== submenu.hostTabId ||
          (target.kind === "tab-destination" && !itemBelongsToSubmenu(submenu.items, target.path))
        ) {
          closeSubmenu();
          return;
        }
        clearOpenTimer();
        clearCloseTimer();
        pendingHostRef.current = null;
        activeHostKeyRef.current = `${target.tabId}\u0000${normalizePath(
          submenu.hostPath ?? "",
        )}`;
        return;
      }

      if (target.kind !== "tab") {
        closeSubmenu();
        return;
      }

      const tabId = target.tabId ?? null;
      const path = target.path.trim();
      if (!tabId || !path) {
        closeSubmenu();
        return;
      }

      clearCloseTimer();
      if (
        submenu.hostTabId === tabId &&
        normalizePath(submenu.hostPath ?? "") === normalizePath(path)
      ) {
        clearOpenTimer();
        pendingHostRef.current = null;
        return;
      }

      if (
        pendingHostRef.current?.tabId === tabId &&
        normalizePath(pendingHostRef.current.path) === normalizePath(path)
      ) {
        return;
      }

      clearOpenTimer();
      pendingHostRef.current = { tabId, path };
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        const nextHost = pendingHostRef.current;
        pendingHostRef.current = null;
        if (!nextHost) return;
        void openSubmenu(nextHost.tabId, nextHost.path);
      }, TAB_SUBMENU_HOVER_DELAY_MS);
    },
    [
      clearCloseTimer,
      clearOpenTimer,
      closeSubmenu,
      enabled,
      openSubmenu,
      scheduleClose,
      submenu.hostPath,
      submenu.hostTabId,
      submenu.items,
    ],
  );

  useEffect(() => {
    closeSubmenu();
  }, [closeSubmenu, enabled, includeParent, includeSubfolders]);

  useEffect(() => {
    if (!enabled || !includeSubfolders || !activeHostKeyRef.current) return;
    const hostPath = submenu.hostPath;
    const hostTabId = submenu.hostTabId;
    if (!hostPath || !hostTabId) return;
    if (submenu.loading) return;
    const cacheKey = normalizePath(hostPath);
    const cachedEntry = cacheRef.current.get(cacheKey) ?? null;
    const currentVersion = getDirectoryChildVersion(hostPath);
    if (cachedEntry && cachedEntry.version === currentVersion) return;
    void openSubmenu(hostTabId, hostPath);
  }, [
    directoryChildRevision,
    enabled,
    includeSubfolders,
    openSubmenu,
    submenu.hostPath,
    submenu.hostTabId,
    submenu.loading,
  ]);

  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
      requestIdRef.current += 1;
    },
    [clearCloseTimer, clearOpenTimer],
  );

  return {
    submenu,
    updateTarget,
    closeSubmenu,
  };
};
