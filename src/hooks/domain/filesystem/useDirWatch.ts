// Background directory change detection with silent refresh + tab dirty
// tracking. Native watcher payloads are normalized before they enter the
// debounce queue so the refresh path only deals with one change shape.
import { useCallback, useEffect, useRef } from "react";
import { folderPathKey, makeDebug } from "@/lib";
import { bumpDirectoryChildVersions } from "@/modules";
import type { FileEntry, SortState, Tab } from "@/types";
import type { LoadDirOptions, MetaRequestOptions } from "./fileManager.types";
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
import { markDirectoryWatchFailed, useDirectoryWatchRecovery } from "./useDirectoryWatchRecovery";

type UseDirWatchOptions = {
  pane?: "main" | "bottom";
  sharesWatch?: boolean;
  enabled: boolean;
  activeTabId: string | null;
  activeTabPath: string;
  currentPath: string;
  tabs: Tab[];
  sortState: SortState;
  entryByPath: ReadonlyMap<string, FileEntry>;
  searchQuery: string;
  loadDir: (path: string, options?: LoadDirOptions) => Promise<void>;
  requestEntryMeta?: (paths: string[], options?: MetaRequestOptions) => Promise<unknown>;
  loading: boolean;
  onPresenceToggle?: (suppress: boolean) => void;
};

const DIR_CHANGE_DEBOUNCE_MS = 260;
const TAB_SWITCH_CHECK_DELAY_MS = 140;
const TAB_SWITCH_REFRESH_COOLDOWN_MS = 2000;
const REFRESH_COOLDOWN_MS = 900;
// Windows may expose a file's updated size or timestamp after the write event.
const WRITE_CHECK_DELAYS_MS = [1000, 2000, 4000];

type PendingFolderChange = {
  path: string;
  entryPaths: Set<string>;
  rename: boolean;
  rescan: boolean;
  writesOnly: boolean;
};

const log = makeDebug("watch");

export const useDirWatch = ({
  pane = "main",
  sharesWatch = false,
  enabled,
  activeTabId,
  activeTabPath,
  currentPath,
  tabs,
  sortState,
  entryByPath,
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
  const entriesRef = useRef(entryByPath);
  const searchRef = useRef(searchQuery);
  const loadDirRef = useRef(loadDir);
  // Optional metadata refresh for changed entries to keep thumbnails accurate.
  const requestEntryMetaRef = useRef(requestEntryMeta);
  const loadingRef = useRef(loading);
  const schedulerRef = useRef(createWatchRefreshSchedulerState());
  const pendingChangesRef = useRef(new Map<string, PendingFolderChange>());
  const recoveryPathRef = useRef("");
  const refreshActiveRef = useRef<(reason: string) => void>(() => {});
  const presenceToggleRef = useRef<((suppress: boolean) => void) | null>(null);
  const externalSuppressedRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const lastTabIdRef = useRef<string | null>(null);
  const tabCheckTimerRef = useRef<number | null>(null);
  const writeCheckTimerRef = useRef<number | null>(null);
  const writeChecksRef = useRef<{ key: string; paths: Set<string> } | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
    activeTabIdRef.current = activeTabId;
    activeTabPathRef.current = activeTabPath;
    currentPathRef.current = currentPath;
    tabsRef.current = tabs;
    sortRef.current = sortState;
    entriesRef.current = entryByPath;
    searchRef.current = searchQuery;
    loadDirRef.current = loadDir;
    requestEntryMetaRef.current = requestEntryMeta;
    loadingRef.current = loading;
    presenceToggleRef.current = onPresenceToggle ?? null;
  }, [
    activeTabId,
    activeTabPath,
    currentPath,
    entryByPath,
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

  const clearDeferredRefresh = useCallback(() => {
    if (refreshTimerRef.current != null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
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
    if (decision.kind === "defer") {
      if (refreshTimerRef.current != null) return;
      const tab = activeTabIdRef.current;
      const path = folderPathKey(activeTabPathRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        if (tab === activeTabIdRef.current && path === folderPathKey(activeTabPathRef.current)) {
          refreshActiveRef.current("coalesced");
        }
      }, decision.delayMs);
      return;
    }
    if (decision.kind !== "start") return;
    clearDeferredRefresh();
    const recovery = recoveryPathRef.current === folderPathKey(decision.viewPath);
    if (recovery) recoveryPathRef.current = "";
    if (decision.suppressPresence) {
      setExternalSuppressed(true);
    }

    const options: LoadDirOptions = {
      sort: sortRef.current,
      search: searchRef.current,
      force: true,
      silent: true,
      includeMeta: recovery || undefined,
      suppressError: recovery || undefined,
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
  }, [clearDeferredRefresh, setExternalSuppressed]);

  useEffect(() => {
    refreshActiveRef.current = refreshActive;
  }, [refreshActive]);

  const clearWriteChecks = useCallback(() => {
    if (writeCheckTimerRef.current != null) {
      window.clearTimeout(writeCheckTimerRef.current);
      writeCheckTimerRef.current = null;
    }
    writeChecksRef.current = null;
  }, []);

  const checkWrittenFiles = useCallback((key: string, paths: string[]) => {
    let refreshRequested = false;
    void requestEntryMetaRef.current?.(paths, {
      force: true,
      onFileChecked: (path, meta) => {
        if (refreshRequested || !enabledRef.current ||
          folderPathKey(currentPathRef.current) !== key || folderPathKey(activeTabPathRef.current) !== key) return;
        const entry = entriesRef.current.get(path);
        const sort = sortRef.current.key;
        // Metadata changes can invalidate the native order or a size filter.
        // Let the listing apply its normal comparator and filter in those cases.
        const sizeSensitive = sort === "size" || /(?:^|\s)size:|[<>=]/i.test(searchRef.current);
        if (meta?.size == null || !entry || entry.isDir ||
          (sizeSensitive && entry.size !== meta.size) ||
          (sort === "modified" && entry.modified !== meta.modified)) {
          refreshRequested = true;
          refreshActiveRef.current("fs-write-layout");
        }
      },
    }).catch(() => {});
  }, []);

  const scheduleWriteChecks = useCallback((key: string, paths: string[]) => {
    const previous = writeChecksRef.current;
    const pending = previous?.key === key ? previous : { key, paths: new Set<string>() };
    for (const path of paths) pending.paths.add(path);
    writeChecksRef.current = pending;
    if (writeCheckTimerRef.current != null) window.clearTimeout(writeCheckTimerRef.current);

    const scheduleStep = (index: number) => {
      writeCheckTimerRef.current = window.setTimeout(() => {
        writeCheckTimerRef.current = null;
        if (!enabledRef.current || folderPathKey(activeTabPathRef.current) !== key ||
          folderPathKey(currentPathRef.current) !== key) {
          writeChecksRef.current = null;
          return;
        }
        checkWrittenFiles(key, [...pending.paths]);
        if (index + 1 < WRITE_CHECK_DELAYS_MS.length) scheduleStep(index + 1);
        else writeChecksRef.current = null;
      }, WRITE_CHECK_DELAYS_MS[index]);
    };

    scheduleStep(0);
  }, [checkWrittenFiles]);

  const recoverVisibleFolder = useCallback((path: string) => {
    const key = folderPathKey(path);
    if (!key || key !== folderPathKey(activeTabPathRef.current)) return;
    recoveryPathRef.current = key;
    clearWriteChecks();
    refreshActiveRef.current("watch-recovery");
  }, [clearWriteChecks]);

  const flushPendingChanges = useCallback(() => {
    const pending = pendingChangesRef.current;
    if (pending.size === 0) return;
    if (!enabledRef.current) {
      pending.clear();
      return;
    }
    const activeKey = folderPathKey(activeTabPathRef.current);
    const currentKey = folderPathKey(currentPathRef.current);
    const activeChange = pending.get(activeKey);
    const metaPaths = [...(pending.get(currentKey)?.entryPaths ?? [])];
    const changes = [...pending.values()];
    pending.clear();
    const paths = changes.map(({ path }) => path);
    // The main subscriber observes events from both native watches. Publish each
    // shared folder revision once, while both panes update their own tab state.
    if (pane === "main") bumpDirectoryChildVersions(paths);
    const changeResult = consumePendingChanges(schedulerRef.current, {
      pendingPaths: paths,
      renamePaths: changes.filter(({ rename }) => rename).map(({ path }) => path),
      activeTabId: activeTabIdRef.current,
      activeTabPath: activeTabPathRef.current,
      tabs: tabsRef.current,
    });

    if (changeResult.shouldRefreshActive) {
      if (activeChange?.rescan) recoverVisibleFolder(activeTabPathRef.current);
      else if (activeChange?.writesOnly && activeKey === currentKey && !loadingRef.current &&
        requestEntryMetaRef.current && metaPaths.length > 0 &&
        metaPaths.every((path) => entriesRef.current.get(path)?.isDir === false)) {
        checkWrittenFiles(currentKey, metaPaths);
        scheduleWriteChecks(currentKey, metaPaths);
        return;
      } else {
        clearWriteChecks();
        refreshActiveRef.current("fs-event");
      }
    }

    if (metaPaths.length > 0) {
      // Retain changed entries while the listing refresh and bounded stats settle.
      void requestEntryMetaRef.current?.(metaPaths, { force: true }).catch(() => {});
    }
  }, [checkWrittenFiles, clearWriteChecks, pane, recoverVisibleFolder, scheduleWriteChecks]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushPendingChanges();
    }, DIR_CHANGE_DEBOUNCE_MS);
  }, [flushPendingChanges]);

  const queueWatchChange = useCallback(
    (change: QueuedWatchChange) => {
      const key = folderPathKey(change.watchedPath);
      if (change.watchFailed) markDirectoryWatchFailed(pane, change.watchedPath);
      const pending = pendingChangesRef.current;
      const folder = pending.get(key) ?? {
        path: change.watchedPath, entryPaths: new Set<string>(), rename: false, rescan: false, writesOnly: true,
      };
      folder.rename ||= change.rename === true;
      folder.rescan ||= Boolean(change.rescan || change.watchFailed);
      folder.writesOnly &&= change.writing === true && change.entryPaths.length > 0 && !folder.rename && !folder.rescan;
      for (const path of change.entryPaths) folder.entryPaths.add(path);
      pending.set(key, folder);
      scheduleFlush();
    },
    [pane, scheduleFlush],
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

  useDirectoryWatchRecovery({ enabled, pane, sharesWatch, path: activeTabPath, refreshFolder: recoverVisibleFolder });

  useEffect(() => {
    if (recoveryPathRef.current !== folderPathKey(activeTabPath)) recoveryPathRef.current = "";
    clearDeferredRefresh();
    if (!enabled || writeChecksRef.current?.key !== folderPathKey(activeTabPath)) clearWriteChecks();
  }, [activeTabId, activeTabPath, clearDeferredRefresh, clearWriteChecks, enabled]);

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
      clearWriteChecks();
      clearDeferredRefresh();
    };
  }, [clearDeferredRefresh, clearWriteChecks]);
};
