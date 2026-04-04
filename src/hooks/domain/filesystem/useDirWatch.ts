// Background directory change detection with silent refresh + tab dirty
// tracking. Native watcher payloads are normalized before they enter the
// debounce queue so the refresh path only deals with one change shape.
import { useCallback, useEffect, useRef } from "react";
import { startDirWatch, stopDirWatch } from "@/api";
import { makeDebug, normalizePath } from "@/lib";
import { bumpDirectoryChildVersions } from "@/modules";
import type { ListDirOptions, SortState, Tab } from "@/types";
import {
  consumePendingChanges,
  consumeQueuedRefreshWhenIdle,
  createWatchRefreshSchedulerState,
  evaluateActiveRefresh,
  finishRefreshRun,
  markActiveTabSynced,
  pruneSchedulerTabs,
  shouldRefreshOnTabSwitch,
} from "./watchRefreshScheduler";
import {
  normalizeDirChangedEvent,
  normalizeDirRenameEvent,
  subscribeToWatchEvent,
  type QueuedWatchChange,
} from "./watchEventSubscriptions";

type MetaRequestOptions = {
  force?: boolean;
  defer?: boolean;
};

type UseDirWatchOptions = {
  enabled: boolean;
  activeTabId: string | null;
  activeTabPath: string;
  currentPath: string;
  tabs: Tab[];
  sortState: SortState;
  searchQuery: string;
  loadDir: (path: string, options?: DirLoadOptions) => Promise<void>;
  requestEntryMeta?: (paths: string[], options?: MetaRequestOptions) => Promise<unknown>;
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
// Extra refreshes after a change help catch slow/partial writes (1s, 2s, 4s).
const REFRESH_BACKOFF_STEPS_MS = [1000, 2000, 4000];

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
  requestEntryMeta,
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
  // Optional metadata refresh for changed entries to keep thumbnails accurate.
  const requestEntryMetaRef = useRef(requestEntryMeta);
  const loadingRef = useRef(loading);
  const schedulerRef = useRef(createWatchRefreshSchedulerState());
  const pendingRenamePathsRef = useRef<Set<string>>(new Set());
  const refreshActiveRef = useRef<(reason: string) => void>(() => {});
  const presenceToggleRef = useRef<((suppress: boolean) => void) | null>(null);
  const externalSuppressedRef = useRef(false);
  const pendingPathsRef = useRef<Set<string>>(new Set());
  const pendingEntryPathsRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<number | null>(null);
  const lastTabIdRef = useRef<string | null>(null);
  const tabCheckTimerRef = useRef<number | null>(null);
  const refreshBackoffTimerRef = useRef<number | null>(null);
  const refreshBackoffStepRef = useRef(0);
  const refreshBackoffKeyRef = useRef<string | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
    activeTabIdRef.current = activeTabId;
    activeTabPathRef.current = activeTabPath;
    currentPathRef.current = currentPath;
    tabsRef.current = tabs;
    sortRef.current = sortState;
    searchRef.current = searchQuery;
    loadDirRef.current = loadDir;
    requestEntryMetaRef.current = requestEntryMeta;
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
    requestEntryMeta,
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
    const decision = evaluateActiveRefresh(schedulerRef.current, {
      enabled: enabledRef.current,
      activeTabId: activeTabIdRef.current,
      activeTabPath: activeTabPathRef.current,
      currentPath: currentPathRef.current,
      loading: loadingRef.current,
      now: Date.now(),
      refreshCooldownMs: REFRESH_COOLDOWN_MS,
    });
    if (decision.kind !== "start") return;
    if (decision.suppressPresence) {
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
    log("refresh(%s): %s", reason, decision.viewPath);
    void loadDirRef.current(decision.viewPath, options).finally(() => {
      const runQueued = finishRefreshRun(schedulerRef.current);
      if (decision.suppressPresence) {
        setExternalSuppressed(false);
      }
      if (runQueued) {
        refreshActiveRef.current("queued");
      }
    });
  }, [setExternalSuppressed]);

  useEffect(() => {
    refreshActiveRef.current = refreshActive;
  }, [refreshActive]);

  const clearRefreshBackoff = useCallback(() => {
    if (refreshBackoffTimerRef.current != null) {
      window.clearTimeout(refreshBackoffTimerRef.current);
      refreshBackoffTimerRef.current = null;
    }
    refreshBackoffStepRef.current = 0;
    refreshBackoffKeyRef.current = null;
  }, []);

  const scheduleRefreshBackoff = useCallback(
    (path: string) => {
      const key = normalizePath(path);
      if (!key) return;

      refreshBackoffKeyRef.current = key;
      refreshBackoffStepRef.current = 0;
      if (refreshBackoffTimerRef.current != null) {
        window.clearTimeout(refreshBackoffTimerRef.current);
        refreshBackoffTimerRef.current = null;
      }

      const scheduleStep = (stepIndex: number) => {
        const delay = REFRESH_BACKOFF_STEPS_MS[stepIndex];
        if (delay == null) return;
        refreshBackoffTimerRef.current = window.setTimeout(() => {
          refreshBackoffTimerRef.current = null;
          if (!enabledRef.current) return;
          const activeKey = normalizePath(activeTabPathRef.current);
          if (!activeKey || activeKey !== refreshBackoffKeyRef.current) return;
          refreshActiveRef.current("fs-backoff");
          const nextIndex = stepIndex + 1;
          if (nextIndex < REFRESH_BACKOFF_STEPS_MS.length) {
            scheduleStep(nextIndex);
          }
        }, delay);
      };

      scheduleStep(0);
    },
    [],
  );

  const flushPendingChanges = useCallback(() => {
    if (
      pendingPathsRef.current.size === 0 &&
      pendingEntryPathsRef.current.size === 0
    ) {
      return;
    }
    const pending = Array.from(pendingPathsRef.current);
    pendingPathsRef.current.clear();
    if (pending.length > 0) {
      bumpDirectoryChildVersions(pending);
    }
    const metaPaths = Array.from(pendingEntryPathsRef.current)
      .map((path) => path.trim())
      .filter(Boolean);
    pendingEntryPathsRef.current.clear();
    const renamePending = new Set(pendingRenamePathsRef.current);
    pendingRenamePathsRef.current.clear();
    const changeResult = consumePendingChanges(schedulerRef.current, {
      pendingPaths: pending,
      renamePaths: Array.from(renamePending),
      activeTabId: activeTabIdRef.current,
      activeTabPath: activeTabPathRef.current,
      tabs: tabsRef.current,
    });

    if (changeResult.shouldRefreshActive) {
      refreshActiveRef.current("fs-event");
      // Re-check after a short backoff in case a large write finishes later.
      scheduleRefreshBackoff(activeTabPathRef.current);
    }

    if (metaPaths.length > 0) {
      // Force metadata refresh for changed entries so thumbnail signatures update.
      void requestEntryMetaRef.current?.(metaPaths, { force: true }).catch(() => {});
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushPendingChanges();
    }, DIR_CHANGE_DEBOUNCE_MS);
  }, [flushPendingChanges]);

  const queueWatchChange = useCallback(
    (change: QueuedWatchChange) => {
      pendingPathsRef.current.add(change.watchedPath);
      change.renamePaths.forEach((path) => {
        pendingRenamePathsRef.current.add(path);
      });
      change.entryPaths.forEach((path) => {
        pendingEntryPathsRef.current.add(path);
      });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  useEffect(() => {
    if (!enabled) return;
    return subscribeToWatchEvent({
      eventName: "dir_changed",
      normalizePayload: normalizeDirChangedEvent,
      onChange: queueWatchChange,
      onError: (error) => {
        log("listen failed: %o", error);
      },
    });
  }, [enabled, queueWatchChange]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeToWatchEvent({
      eventName: "dir_rename",
      normalizePayload: normalizeDirRenameEvent,
      onChange: queueWatchChange,
      onError: (error) => {
        log("rename listen failed: %o", error);
      },
    });
  }, [enabled, queueWatchChange]);

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
    pruneSchedulerTabs(schedulerRef.current, tabs);
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
      if (
        shouldRefreshOnTabSwitch(
          schedulerRef.current,
          tabId,
          Date.now(),
          TAB_SWITCH_REFRESH_COOLDOWN_MS,
        )
      ) {
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
    if (consumeQueuedRefreshWhenIdle(schedulerRef.current, enabled, loading)) {
      refreshActiveRef.current("queued");
    }
  }, [enabled, loading]);

  useEffect(() => {
    markActiveTabSynced(
      schedulerRef.current,
      activeTabId,
      activeTabPath,
      currentPath,
      Date.now(),
    );
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
      clearRefreshBackoff();
    };
  }, [clearRefreshBackoff]);
};
