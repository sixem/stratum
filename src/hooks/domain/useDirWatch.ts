// Background directory change detection with silent refresh + tab dirty tracking.
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";
import { startDirWatch, stopDirWatch } from "@/api";
import { makeDebug, normalizePath } from "@/lib";
import type { DirChangedEvent, DirRenameEvent, ListDirOptions, SortState, Tab } from "@/types";

type UseDirWatchOptions = {
  enabled: boolean;
  activeTabId: string | null;
  activeTabPath: string;
  currentPath: string;
  tabs: Tab[];
  sortState: SortState;
  searchQuery: string;
  loadDir: (path: string, options?: DirLoadOptions) => Promise<void>;
  loading: boolean;
  onPresenceToggle?: (suppress: boolean) => void;
};

type DirLoadOptions = ListDirOptions & {
  force?: boolean;
  silent?: boolean;
};

const DIR_CHANGE_DEBOUNCE_MS = 260;
const TAB_SWITCH_CHECK_DELAY_MS = 140;
const TAB_SWITCH_REFRESH_COOLDOWN_MS = 2000;
const REFRESH_COOLDOWN_MS = 900;

const log = makeDebug("watch");

export const useDirWatch = ({
  enabled,
  activeTabId,
  activeTabPath,
  currentPath,
  tabs,
  sortState,
  searchQuery,
  loadDir,
  loading,
  onPresenceToggle,
}: UseDirWatchOptions) => {
  const enabledRef = useRef(enabled);
  const activeTabIdRef = useRef(activeTabId);
  const activeTabPathRef = useRef(activeTabPath);
  const currentPathRef = useRef(currentPath);
  const tabsRef = useRef(tabs);
  const sortRef = useRef(sortState);
  const searchRef = useRef(searchQuery);
  const loadDirRef = useRef(loadDir);
  const loadingRef = useRef(loading);
  const dirtyTabIdsRef = useRef<Set<string>>(new Set());
  const renameDirtyTabIdsRef = useRef<Set<string>>(new Set());
  const pendingRenamePathsRef = useRef<Set<string>>(new Set());
  const lastRefreshRef = useRef<Map<string, number>>(new Map());
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const refreshActiveRef = useRef<(reason: string) => void>(() => {});
  const presenceToggleRef = useRef<((suppress: boolean) => void) | null>(null);
  const externalSuppressedRef = useRef(false);
  const suppressNextRefreshRef = useRef(false);
  const pendingPathsRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<number | null>(null);
  const lastTabIdRef = useRef<string | null>(null);
  const tabCheckTimerRef = useRef<number | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
    activeTabIdRef.current = activeTabId;
    activeTabPathRef.current = activeTabPath;
    currentPathRef.current = currentPath;
    tabsRef.current = tabs;
    sortRef.current = sortState;
    searchRef.current = searchQuery;
    loadDirRef.current = loadDir;
    loadingRef.current = loading;
    presenceToggleRef.current = onPresenceToggle ?? null;
  }, [
    activeTabId,
    activeTabPath,
    currentPath,
    enabled,
    loadDir,
    loading,
    onPresenceToggle,
    searchQuery,
    sortState,
    tabs,
  ]);

  const setExternalSuppressed = useCallback((next: boolean) => {
    if (externalSuppressedRef.current === next) return;
    externalSuppressedRef.current = next;
    presenceToggleRef.current?.(next);
  }, []);

  const refreshActive = useCallback((reason: string) => {
    if (!enabledRef.current) return;
    const tabId = activeTabIdRef.current;
    const viewPath = activeTabPathRef.current.trim();
    if (!tabId || !viewPath) return;
    if (loadingRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    const viewKey = normalizePath(viewPath);
    const currentKey = normalizePath(currentPathRef.current);
    if (!viewKey || viewKey !== currentKey) {
      dirtyTabIdsRef.current.add(tabId);
      return;
    }

    const now = Date.now();
    const lastRefresh = lastRefreshRef.current.get(tabId) ?? 0;
    if (now - lastRefresh < REFRESH_COOLDOWN_MS) {
      refreshQueuedRef.current = true;
      return;
    }
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;
    refreshQueuedRef.current = false;
    lastRefreshRef.current.set(tabId, now);
    dirtyTabIdsRef.current.delete(tabId);
    const shouldSuppress =
      suppressNextRefreshRef.current || renameDirtyTabIdsRef.current.has(tabId);
    if (shouldSuppress) {
      suppressNextRefreshRef.current = false;
      renameDirtyTabIdsRef.current.delete(tabId);
      setExternalSuppressed(true);
    }

    const options: DirLoadOptions = {
      sort: sortRef.current,
      search: searchRef.current,
      force: true,
      silent: true,
      // Avoid fast + full double refreshes when sorting by size/modified.
      // A single full refresh keeps ordering stable and prevents flicker.
      fast: sortRef.current.key === "name",
    };
    log("refresh(%s): %s", reason, viewPath);
    void loadDirRef.current(viewPath, options).finally(() => {
      refreshInFlightRef.current = false;
      if (shouldSuppress) {
        setExternalSuppressed(false);
      }
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        refreshActiveRef.current("queued");
      }
    });
  }, [setExternalSuppressed]);

  useEffect(() => {
    refreshActiveRef.current = refreshActive;
  }, [refreshActive]);

  const flushPendingChanges = useCallback(() => {
    if (pendingPathsRef.current.size === 0) return;
    const pending = Array.from(pendingPathsRef.current);
    pendingPathsRef.current.clear();
    const renamePending = new Set(pendingRenamePathsRef.current);
    pendingRenamePathsRef.current.clear();
    const renameKeys = new Set<string>();
    renamePending.forEach((path) => {
      const key = normalizePath(path);
      if (key) {
        renameKeys.add(key);
      }
    });

    const activeId = activeTabIdRef.current;
    const activeKey = normalizePath(activeTabPathRef.current);
    const tabsSnapshot = tabsRef.current;
    let shouldRefreshActive = false;
    let shouldSuppressActive = false;

    pending.forEach((rawPath) => {
      const key = normalizePath(rawPath);
      if (!key) return;
      const isRename = renameKeys.has(key);
      tabsSnapshot.forEach((tab) => {
        const tabKey = normalizePath(tab.path);
        if (!tabKey || tabKey !== key) return;
        if (tab.id === activeId && activeKey === key) {
          shouldRefreshActive = true;
          if (isRename) {
            shouldSuppressActive = true;
          }
        } else {
          dirtyTabIdsRef.current.add(tab.id);
          if (isRename) {
            renameDirtyTabIdsRef.current.add(tab.id);
          }
        }
      });
    });

    if (shouldRefreshActive) {
      if (shouldSuppressActive) {
        suppressNextRefreshRef.current = true;
      }
      refreshActiveRef.current("fs-event");
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushPendingChanges();
    }, DIR_CHANGE_DEBOUNCE_MS);
  }, [flushPendingChanges]);

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | null = null;
    let active = true;
    const setup = async () => {
      try {
        const stop = await listen<DirChangedEvent>("dir_changed", (event) => {
          const payload = event.payload;
          if (!payload?.path) return;
          pendingPathsRef.current.add(payload.path);
          scheduleFlush();
        });
        if (!active) {
          stop();
          return;
        }
        unlisten = stop;
      } catch (error) {
        log("listen failed: %o", error);
      }
    };
    void setup();
    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [enabled, scheduleFlush]);

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | null = null;
    let active = true;
    const setup = async () => {
      try {
        const stop = await listen<DirRenameEvent>("dir_rename", (event) => {
          const payload = event.payload;
          if (!payload?.path) return;
          pendingPathsRef.current.add(payload.path);
          pendingRenamePathsRef.current.add(payload.path);
          scheduleFlush();
        });
        if (!active) {
          stop();
          return;
        }
        unlisten = stop;
      } catch (error) {
        log("rename listen failed: %o", error);
      }
    };
    void setup();
    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [enabled, scheduleFlush]);

  useEffect(() => {
    if (!enabled) return;
    const target = activeTabPath.trim();
    if (!target) {
      void stopDirWatch();
      return;
    }
    void startDirWatch(target).catch((error) => {
      log("start watch failed: %o", error);
    });
    return () => {
      void stopDirWatch();
    };
  }, [activeTabPath, enabled]);

  useEffect(() => {
    // Drop stale IDs when tabs close so dirty/refresh maps stay bounded.
    const ids = new Set(tabs.map((tab) => tab.id));
    dirtyTabIdsRef.current.forEach((id) => {
      if (!ids.has(id)) {
        dirtyTabIdsRef.current.delete(id);
      }
    });
    renameDirtyTabIdsRef.current.forEach((id) => {
      if (!ids.has(id)) {
        renameDirtyTabIdsRef.current.delete(id);
      }
    });
    lastRefreshRef.current.forEach((_value, id) => {
      if (!ids.has(id)) {
        lastRefreshRef.current.delete(id);
      }
    });
  }, [tabs]);

  useEffect(() => {
    if (!enabled) return;
    if (!activeTabId) return;
    if (lastTabIdRef.current === activeTabId) return;
    lastTabIdRef.current = activeTabId;
    if (tabCheckTimerRef.current != null) {
      window.clearTimeout(tabCheckTimerRef.current);
    }
    tabCheckTimerRef.current = window.setTimeout(() => {
      tabCheckTimerRef.current = null;
      const tabId = activeTabIdRef.current;
      if (!tabId) return;
      const isDirty = dirtyTabIdsRef.current.has(tabId);
      const lastRefresh = lastRefreshRef.current.get(tabId) ?? 0;
      const now = Date.now();
      if (isDirty || now - lastRefresh > TAB_SWITCH_REFRESH_COOLDOWN_MS) {
        refreshActiveRef.current("tab-switch");
      }
    }, TAB_SWITCH_CHECK_DELAY_MS);
    return () => {
      if (tabCheckTimerRef.current != null) {
        window.clearTimeout(tabCheckTimerRef.current);
        tabCheckTimerRef.current = null;
      }
    };
  }, [activeTabId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (loading) return;
    if (!refreshQueuedRef.current) return;
    refreshQueuedRef.current = false;
    refreshActiveRef.current("queued");
  }, [enabled, loading]);

  useEffect(() => {
    if (!activeTabId) return;
    const viewKey = normalizePath(activeTabPath);
    const currentKey = normalizePath(currentPath);
    if (!viewKey || viewKey !== currentKey) return;
    dirtyTabIdsRef.current.delete(activeTabId);
    renameDirtyTabIdsRef.current.delete(activeTabId);
    lastRefreshRef.current.set(activeTabId, Date.now());
  }, [activeTabId, activeTabPath, currentPath]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (tabCheckTimerRef.current != null) {
        window.clearTimeout(tabCheckTimerRef.current);
        tabCheckTimerRef.current = null;
      }
    };
  }, []);
};
