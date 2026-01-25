// Orchestrates tab state, view settings, and navigation flows.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shallow } from "zustand/shallow";
import type { ListDirOptions, SortState, Tab, ViewMode } from "@/types";
import { createTab, DEFAULT_TAB_STATE, makeDebug, normalizePath } from "@/lib";
import { useSessionStore } from "@/modules";

type TabSessionOptions = {
  currentPath: string;
  loadDir: (path: string, options?: ListDirOptions) => Promise<void>;
  clearDir: (options?: { silent?: boolean }) => void;
  defaultViewMode: ViewMode;
  recentJumpsLimit: number;
};

type TabHistory = {
  back: string[];
  forward: string[];
};

const HISTORY_LIMIT = 40;
const log = makeDebug("tabs");

// Breadcrumb trail helpers keep future crumbs visible when navigating up.
const splitPathKey = (pathKey: string) => {
  if (!pathKey) return [];
  return pathKey.split("\\").filter(Boolean);
};

const isPathKeyPrefix = (prefixKey: string, fullKey: string) => {
  const prefixParts = splitPathKey(prefixKey);
  const fullParts = splitPathKey(fullKey);
  if (prefixParts.length === 0) return false;
  if (prefixParts.length > fullParts.length) return false;
  return prefixParts.every((part, index) => part === fullParts[index]);
};

const resolveCrumbTrailPath = (currentPath: string, trailPath: string) => {
  const trimmedCurrent = currentPath.trim();
  if (!trimmedCurrent) return "";
  const trimmedTrail = trailPath.trim();
  if (!trimmedTrail) return trimmedCurrent;
  const currentKey = normalizePath(trimmedCurrent);
  const trailKey = normalizePath(trimmedTrail);
  if (!currentKey || !trailKey) return trimmedCurrent;
  if (currentKey === trailKey) return trimmedCurrent;
  // Keep the deepest path when navigating up within the same branch.
  if (isPathKeyPrefix(currentKey, trailKey)) return trimmedTrail;
  // Update the trail when navigating deeper under the same branch.
  if (isPathKeyPrefix(trailKey, currentKey)) return trimmedCurrent;
  // Reset the trail when the branch changes.
  return trimmedCurrent;
};

export const useTabSession = ({
  currentPath,
  loadDir,
  clearDir,
  defaultViewMode,
  recentJumpsLimit,
}: TabSessionOptions) => {
  const { tabs, activeTabId, recentJumps, setTabs, setActiveTabId, setRecentJumps } =
    useSessionStore(
      (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        recentJumps: state.recentJumps,
        setTabs: state.setTabs,
        setActiveTabId: state.setActiveTabId,
        setRecentJumps: state.setRecentJumps,
      }),
      shallow,
    );

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
  );
  const defaultTabState = useMemo(
    () => ({
      viewMode: defaultViewMode,
      sort: DEFAULT_TAB_STATE.sort,
      search: DEFAULT_TAB_STATE.search,
    }),
    [defaultViewMode],
  );
  const viewMode = activeTab?.viewMode ?? defaultTabState.viewMode;
  const sortState = activeTab?.sort ?? defaultTabState.sort;
  // Keep search filters tied to their owning tab.
  const searchValue = activeTab?.search ?? defaultTabState.search;
  const safeRecentLimit = Number.isFinite(recentJumpsLimit)
    ? Math.max(1, Math.round(recentJumpsLimit))
    : 1;

  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const historyRef = useRef<Map<string, TabHistory>>(new Map());
  const [, forceHistoryUpdate] = useState(0);
  const pendingJumpSourceRef = useRef<"navigate" | "switch" | null>(null);
  const skipHistoryRef = useRef(false);
  // Track which tab initiated a navigation so empty tabs do not inherit other paths.
  const pendingJumpTabRef = useRef<string | null>(null);
  // Track tabs that should stay empty until the user navigates inside them.
  const emptyTabIdsRef = useRef<Set<string>>(new Set());
  const restorePathRef = useRef<string | null>(
    tabs.find((tab) => tab.id === activeTabId)?.path ?? null,
  );
  const restoreRequestedRef = useRef(false);
  const suppressTabSyncRef = useRef(Boolean(restorePathRef.current));
  // Hold target path after tab switches to avoid transient path flicker.
  const pendingTabPathRef = useRef<string | null>(null);
  // Avoid redundant reloads when switching tabs that point at the current path.
  const shouldLoadPath = useCallback(
    (path: string) => {
      const targetKey = normalizePath(path);
      const currentKey = normalizePath(currentPath);
      if (!targetKey || !currentKey) return true;
      return targetKey !== currentKey;
    },
    [currentPath],
  );

  const getHistory = useCallback((tabId: string) => {
    const store = historyRef.current;
    const existing = store.get(tabId);
    if (existing) return existing;
    const created = { back: [], forward: [] };
    store.set(tabId, created);
    return created;
  }, []);

  const bumpHistory = useCallback(() => {
    forceHistoryUpdate((prev) => prev + 1);
  }, []);

  const recordHistory = useCallback(
    (tabId: string, fromPath: string, toPath: string) => {
      const trimmedFrom = fromPath.trim();
      const trimmedTo = toPath.trim();
      if (!trimmedFrom || !trimmedTo) return;
      const fromKey = normalizePath(trimmedFrom) ?? trimmedFrom;
      const toKey = normalizePath(trimmedTo) ?? trimmedTo;
      if (!fromKey || !toKey || fromKey === toKey) return;
      const history = getHistory(tabId);
      history.back.push(trimmedFrom);
      history.forward = [];
      if (history.back.length > HISTORY_LIMIT) {
        history.back = history.back.slice(-HISTORY_LIMIT);
      }
      bumpHistory();
    },
    [bumpHistory, getHistory],
  );

  useEffect(() => {
    // Keep the active tab path synced with the current directory.
    if (!currentPath && activeTabId) return;
    // Avoid "stealing" a path for untitled tabs unless we explicitly navigated in them.
    const allowEmptyTabSync =
      pendingJumpSourceRef.current === "navigate" &&
      pendingJumpTabRef.current === activeTabId;
    const isEmptyTab =
      Boolean(activeTab && emptyTabIdsRef.current.has(activeTab.id)) ||
      Boolean(activeTab && !activeTab.path.trim());
    if (isEmptyTab && currentPath.trim() && !allowEmptyTabSync) {
      return;
    }
    const pendingPath = pendingTabPathRef.current;
    if (pendingPath) {
      const pendingKey = normalizePath(pendingPath) ?? pendingPath;
      const currentKey = normalizePath(currentPath) ?? currentPath;
      if (pendingKey && currentKey && pendingKey !== currentKey) {
        return;
      }
      pendingTabPathRef.current = null;
    }
    if (suppressTabSyncRef.current) {
      const target = restorePathRef.current;
      if (target) {
        const targetKey = normalizePath(target);
        const currentKey = normalizePath(currentPath);
        if (targetKey && targetKey !== currentKey) {
          return;
        }
      }
      suppressTabSyncRef.current = false;
      restorePathRef.current = null;
    }
    if (!activeTabId) {
      const nextTab = createTab(currentPath ?? "", undefined, defaultTabState);
      setTabs([nextTab]);
      setActiveTabId(nextTab.id);
      return;
    }
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === activeTabId);
      if (index === -1) return prev;
      const tab = prev[index];
      // Update the crumb trail so breadcrumb "future" crumbs stay visible.
      const nextTrailPath = resolveCrumbTrailPath(
        currentPath,
        tab.crumbTrailPath ?? tab.path,
      );
      if (tab.path === currentPath && tab.crumbTrailPath === nextTrailPath) {
        // Avoid re-setting identical paths to prevent update loops.
        return prev;
      }
      const next = [...prev];
      next[index] = { ...tab, path: currentPath, crumbTrailPath: nextTrailPath };
      return next;
    });
  }, [activeTab, activeTabId, currentPath, setActiveTabId, setTabs]);

  useEffect(() => {
    // Restore the last active tab path once on startup.
    const target = restorePathRef.current;
    if (!target || restoreRequestedRef.current) return;
    const targetKey = normalizePath(target);
    const currentKey = normalizePath(currentPath);
    if (!targetKey || targetKey === currentKey) {
      suppressTabSyncRef.current = false;
      restorePathRef.current = null;
      return;
    }
    restoreRequestedRef.current = true;
    void loadDir(target, { sort: sortState, search: searchValue });
  }, [currentPath, loadDir, searchValue, sortState]);

  useEffect(() => {
    // Update recent jumps after navigation completes.
    if (!pendingJump) return;
    if (pendingJumpSourceRef.current === "switch") {
      setPendingJump(null);
      pendingJumpSourceRef.current = null;
      pendingJumpTabRef.current = null;
      return;
    }
    const pendingKey = normalizePath(pendingJump);
    const currentKey = normalizePath(currentPath);
    if (!pendingKey || pendingKey !== currentKey) return;
    setRecentJumps((prev) => {
      const next = [pendingJump, ...prev.filter((item) => normalizePath(item) !== pendingKey)];
      return next.slice(0, safeRecentLimit);
    });
    setPendingJump(null);
    pendingJumpSourceRef.current = null;
    pendingJumpTabRef.current = null;
  }, [currentPath, pendingJump, safeRecentLimit, setRecentJumps]);

  useEffect(() => {
    setRecentJumps((prev) => {
      if (prev.length <= safeRecentLimit) return prev;
      return prev.slice(0, safeRecentLimit);
    });
  }, [safeRecentLimit, setRecentJumps]);

  useEffect(() => {
    // Drop closed tabs from history to keep memory bounded.
    const ids = new Set(tabs.map((tab) => tab.id));
    historyRef.current.forEach((_value, id) => {
      if (!ids.has(id)) {
        historyRef.current.delete(id);
      }
    });
  }, [tabs]);

  // Track navigation targets so we can update recents once the load lands.
  const queuePendingJump = useCallback((path: string, source: "navigate" | "switch") => {
    pendingJumpSourceRef.current = source;
    pendingJumpTabRef.current = source === "navigate" ? activeTabId : null;
    setPendingJump(path);
  }, [activeTabId]);

  const performNavigation = useCallback(
    (path: string, options: ListDirOptions | undefined, source: "navigate" | "switch") => {
      const target = path.trim();
      if (!target) {
        clearDir();
        return;
      }
      if (source === "navigate" && activeTabId) {
        emptyTabIdsRef.current.delete(activeTabId);
      }
      queuePendingJump(target, source);
      const nextSort = options?.sort ?? sortState;
      const nextSearch = options?.search ?? searchValue;
      void loadDir(target, { ...options, sort: nextSort, search: nextSearch });
    },
    [activeTabId, clearDir, loadDir, queuePendingJump, searchValue, sortState],
  );

  const navigateTo = useCallback(
    (path: string, options: ListDirOptions | undefined, source: "navigate" | "switch") => {
      const skipHistory = skipHistoryRef.current;
      if (skipHistory) {
        skipHistoryRef.current = false;
      } else if (source === "navigate" && activeTabId) {
        const currentForHistory = activeTab?.path ?? currentPath;
        recordHistory(activeTabId, currentForHistory, path);
      }
      performNavigation(path, options, source);
    },
    [activeTab?.path, activeTabId, currentPath, performNavigation, recordHistory],
  );

  const jumpTo = useCallback(
    (path: string, options?: ListDirOptions) => {
      navigateTo(path, options, "navigate");
    },
    [navigateTo],
  );

  const browseTo = useCallback(
    (path: string, options?: ListDirOptions) => {
      navigateTo(path, options, "navigate");
    },
    [navigateTo],
  );

  const updateActiveTab = useCallback(
    (patch: Partial<Tab>) => {
      if (!activeTabId) return;
      setTabs((prev) =>
        prev.map((tab) => (tab.id === activeTabId ? { ...tab, ...patch } : tab)),
      );
    },
    [activeTabId, setTabs],
  );

  const setTabScrollTop = useCallback(
    (id: string, scrollTop: number) => {
      if (!id) return;
      const nextTop = Math.max(0, Math.round(scrollTop));
      // Skip updates when the stored scroll offset has not changed.
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === id && tab.scrollTop !== nextTop ? { ...tab, scrollTop: nextTop } : tab,
        ),
      );
    },
    [setTabs],
  );

  const setViewMode = useCallback(
    (nextView: ViewMode) => {
      log("view mode -> %s", nextView);
      updateActiveTab({ viewMode: nextView });
    },
    [updateActiveTab],
  );

  const setSort = useCallback(
    (sort: SortState) => {
      log("sort -> %s/%s", sort.key, sort.dir);
      updateActiveTab({ sort });
    },
    [updateActiveTab],
  );

  const setSearch = useCallback(
    (search: string) => {
      log("search -> %s", search);
      updateActiveTab({ search });
    },
    [updateActiveTab],
  );

  const newTab = useCallback(() => {
    log("new tab -> empty");
    const nextTab = createTab("", { viewMode, sort: sortState }, defaultTabState);
    emptyTabIdsRef.current.add(nextTab.id);
    pendingTabPathRef.current = null;
    setTabs((prev) => [...prev, nextTab]);
    setActiveTabId(nextTab.id);
    clearDir({ silent: true });
  }, [clearDir, defaultTabState, setActiveTabId, setTabs, sortState, viewMode]);

  const openInNewTab = useCallback(
    (path: string) => {
      const target = path.trim();
      if (!target) return;
      log("open in new tab -> %s", target);
      const nextTab = createTab(target, { viewMode, sort: sortState }, defaultTabState);
      emptyTabIdsRef.current.delete(nextTab.id);
      pendingTabPathRef.current = normalizePath(target) ?? target;
      setTabs((prev) => [...prev, nextTab]);
      setActiveTabId(nextTab.id);
      skipHistoryRef.current = true;
      jumpTo(target, { sort: nextTab.sort, search: nextTab.search });
    },
    [defaultTabState, jumpTo, setActiveTabId, setTabs, sortState, viewMode],
  );

  const canGoBack = Boolean(
    activeTabId && historyRef.current.get(activeTabId)?.back.length,
  );
  const canGoForward = Boolean(
    activeTabId && historyRef.current.get(activeTabId)?.forward.length,
  );

  const goBack = useCallback(() => {
    if (!activeTabId) return;
    const history = getHistory(activeTabId);
    if (history.back.length === 0) return;
    const current = (activeTab?.path ?? currentPath).trim();
    const next = history.back.pop();
    if (!next) return;
    if (current) {
      history.forward.push(current);
      if (history.forward.length > HISTORY_LIMIT) {
        history.forward = history.forward.slice(-HISTORY_LIMIT);
      }
    }
    bumpHistory();
    performNavigation(next, { sort: sortState, search: searchValue }, "navigate");
  }, [
    activeTab?.path,
    activeTabId,
    bumpHistory,
    currentPath,
    getHistory,
    performNavigation,
    searchValue,
    sortState,
  ]);

  const goForward = useCallback(() => {
    if (!activeTabId) return;
    const history = getHistory(activeTabId);
    if (history.forward.length === 0) return;
    const current = (activeTab?.path ?? currentPath).trim();
    const next = history.forward.pop();
    if (!next) return;
    if (current) {
      history.back.push(current);
      if (history.back.length > HISTORY_LIMIT) {
        history.back = history.back.slice(-HISTORY_LIMIT);
      }
    }
    bumpHistory();
    performNavigation(next, { sort: sortState, search: searchValue }, "navigate");
  }, [
    activeTab?.path,
    activeTabId,
    bumpHistory,
    currentPath,
    getHistory,
    performNavigation,
    searchValue,
    sortState,
  ]);

  const selectTab = useCallback(
    (id: string) => {
      const selected = tabs.find((tab) => tab.id === id);
      if (!selected) return;
      log("select tab -> %s (%s)", id, selected.path);
      const isEmptyTab =
        emptyTabIdsRef.current.has(selected.id) || !selected.path.trim();
      if (isEmptyTab) {
        pendingTabPathRef.current = null;
        if (selected.path.trim()) {
          setTabs((prev) => {
            const index = prev.findIndex((tab) => tab.id === selected.id);
            if (index === -1) return prev;
            const tab = prev[index];
            if (!tab.path.trim()) return prev;
            const next = [...prev];
            next[index] = { ...tab, path: "", crumbTrailPath: "" };
            return next;
          });
        }
        setActiveTabId(id);
        clearDir({ silent: true });
        return;
      }
      pendingTabPathRef.current = normalizePath(selected.path) ?? selected.path;
      setActiveTabId(id);
      if (!shouldLoadPath(selected.path)) {
        return;
      }
      navigateTo(selected.path, { sort: selected.sort, search: selected.search }, "switch");
    },
    [clearDir, navigateTo, setActiveTabId, setTabs, shouldLoadPath, tabs],
  );

  const closeTab = useCallback(
    (id: string) => {
      if (tabs.length <= 1) return;
      log("close tab -> %s", id);
      emptyTabIdsRef.current.delete(id);
      const index = tabs.findIndex((tab) => tab.id === id);
      const nextTabs = tabs.filter((tab) => tab.id !== id);
      setTabs(nextTabs);

      if (id === activeTabId) {
        const fallback = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
        if (fallback) {
          pendingTabPathRef.current = normalizePath(fallback.path) ?? fallback.path;
          setActiveTabId(fallback.id);
          if (!fallback.path.trim()) {
            clearDir({ silent: true });
            return;
          }
          if (shouldLoadPath(fallback.path)) {
            navigateTo(
              fallback.path,
              { sort: fallback.sort, search: fallback.search },
              "switch",
            );
          }
        }
      }
    },
    [activeTabId, clearDir, navigateTo, setActiveTabId, setTabs, shouldLoadPath, tabs],
  );

  const reorderTabs = useCallback(
    (fromId: string, toIndex: number) => {
      setTabs((prev) => {
        const fromIndex = prev.findIndex((tab) => tab.id === fromId);
        if (fromIndex === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        let insertIndex = Math.min(Math.max(toIndex, 0), next.length);
        if (fromIndex < insertIndex) {
          insertIndex -= 1;
        }
        if (insertIndex === fromIndex) return prev;
        next.splice(insertIndex, 0, moved);
        return next;
      });
    },
    [setTabs],
  );

  return {
    tabs,
    activeTabId,
    recentJumps: recentJumps.slice(0, safeRecentLimit),
    activeTab,
    viewMode,
    sortState,
    searchValue,
    canGoBack,
    canGoForward,
    jumpTo,
    browseTo,
    setViewMode,
    setSort,
    setSearch,
    goBack,
    goForward,
    newTab,
    openInNewTab,
    selectTab,
    closeTab,
    reorderTabs,
    setTabScrollTop,
  };
};
