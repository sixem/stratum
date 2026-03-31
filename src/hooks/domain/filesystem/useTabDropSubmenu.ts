// Manages delayed tab-hover submenu state for drag-drop destinations.
import { useCallback, useEffect, useRef, useState } from "react";
import { listDir } from "@/api";
import type { DropTarget, DropTargetSubmenuItem, TabDropSubmenuState } from "@/lib";
import { getPathName, normalizePath } from "@/lib";
import {
  getDirectoryChildVersion,
  useDirectoryChildStateRevision,
} from "@/modules";

type UseTabDropSubmenuOptions = {
  enabled: boolean;
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

export const useTabDropSubmenu = ({ enabled }: UseTabDropSubmenuOptions) => {
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

      const hostKey = `${tabId}\u0000${normalizePath(trimmedPath)}`;
      activeHostKeyRef.current = hostKey;
      const cacheKey = normalizePath(trimmedPath);
      const currentVersion = getDirectoryChildVersion(trimmedPath);
      const cachedEntry = cacheRef.current.get(cacheKey) ?? null;

      if (cachedEntry && cachedEntry.version === currentVersion) {
        setSubmenu(
          cachedEntry.items.length === 0
            ? EMPTY_SUBMENU_STATE
            : {
                hostTabId: tabId,
                hostPath: trimmedPath,
                items: cachedEntry.items,
                loading: false,
              },
        );
        return;
      }

      setSubmenu({
        hostTabId: tabId,
        hostPath: trimmedPath,
        items: [],
        loading: true,
      });

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      try {
        const result = await listDir(trimmedPath, {
          sort: { key: "name", dir: "asc" },
          fast: true,
        });
        if (requestIdRef.current !== requestId) return;
        if (activeHostKeyRef.current !== hostKey) return;
        const items = toSubmenuItems(result.entries);
        touchCache(cacheKey, {
          items,
          version: getDirectoryChildVersion(trimmedPath),
        });
        setSubmenu(
          items.length === 0
            ? EMPTY_SUBMENU_STATE
            : {
                hostTabId: tabId,
                hostPath: trimmedPath,
                items,
                loading: false,
              },
        );
      } catch {
        if (requestIdRef.current !== requestId) return;
        if (activeHostKeyRef.current !== hostKey) return;
        touchCache(cacheKey, {
          items: [],
          version: getDirectoryChildVersion(trimmedPath),
        });
        setSubmenu(EMPTY_SUBMENU_STATE);
      }
    },
    [clearCloseTimer, clearOpenTimer, closeSubmenu, enabled, touchCache],
  );

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    if (submenu.hostTabId == null && pendingHostRef.current == null) return;
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      closeSubmenu();
    }, TAB_SUBMENU_CLOSE_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer, closeSubmenu, submenu.hostTabId]);

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

      if (target.kind === "tab-subfolder") {
        clearOpenTimer();
        clearCloseTimer();
        pendingHostRef.current = null;
        if (target.tabId) {
          activeHostKeyRef.current = `${target.tabId}\u0000${normalizePath(
            submenu.hostPath ?? "",
          )}`;
        }
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
      if (submenu.hostTabId === tabId && normalizePath(submenu.hostPath ?? "") === normalizePath(path)) {
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
    ],
  );

  useEffect(() => {
    if (enabled) return;
    closeSubmenu();
  }, [closeSubmenu, enabled]);

  useEffect(() => {
    if (!enabled) return;
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
