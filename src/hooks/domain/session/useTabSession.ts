// Orchestrates tab state, view settings, and navigation flows.
import { useCallback, useMemo, useRef } from "react";
import { shallow } from "zustand/shallow";
import type { ListDirOptions, SortState, Tab, ViewMode } from "@/types";
import { createTab, DEFAULT_TAB_STATE, makeDebug, normalizePath } from "@/lib";
import { useSessionStore } from "@/modules";
import { useTabHistory } from "./tabHistory";
import { usePendingJump } from "./tabNavigation";
import { useTabPersistence } from "./useTabPersistence";
import { useTabScroll } from "./useTabScroll";

type TabSessionOptions = {
  currentPath: string;
  loadDir: (path: string, options?: ListDirOptions) => Promise<void>;
  clearDir: (options?: { silent?: boolean }) => void;
  defaultViewMode: ViewMode;
  recentJumpsLimit: number;
};

const log = makeDebug("tabs");

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

  const skipHistoryRef = useRef(false);
  // History and pending-jump tracking live in focused hooks to keep this file readable.
  const { canGoBack, canGoForward, recordHistory, popBack, popForward } =
    useTabHistory({ tabs, activeTabId });
  const { queuePendingJump, shouldSyncEmptyTab } = usePendingJump({
    activeTabId,
    currentPath,
    recentLimit: safeRecentLimit,
    setRecentJumps,
  });
  const { emptyTabIdsRef, pendingTabPathRef } = useTabPersistence({
    tabs,
    activeTabId,
    activeTab,
    currentPath,
    sortState,
    searchValue,
    loadDir,
    setTabs,
    setRecentJumps,
    recentLimit: safeRecentLimit,
    shouldSyncEmptyTab,
  });
  const { setTabScrollTop } = useTabScroll({ setTabs });
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

  const ensureActiveTab = useCallback(
    (path: string) => {
      if (activeTabId) return activeTabId;
      const fallback = tabs[0];
      if (fallback) {
        setActiveTabId(fallback.id);
        return fallback.id;
      }
      const nextTab = createTab(
        path,
        { viewMode, sort: sortState, search: searchValue },
        defaultTabState,
      );
      emptyTabIdsRef.current.delete(nextTab.id);
      setTabs([nextTab]);
      setActiveTabId(nextTab.id);
      return nextTab.id;
    },
    [activeTabId, defaultTabState, searchValue, setActiveTabId, setTabs, sortState, tabs, viewMode],
  );

  const performNavigation = useCallback(
    (
      path: string,
      options: ListDirOptions | undefined,
      source: "navigate" | "switch",
      tabId: string | null,
    ) => {
      const target = path.trim();
      if (!target) {
        clearDir();
        return;
      }
      if (source === "navigate" && tabId) {
        emptyTabIdsRef.current.delete(tabId);
      }
      queuePendingJump(target, source, tabId);
      const nextSort = options?.sort ?? sortState;
      const nextSearch = options?.search ?? searchValue;
      void loadDir(target, { ...options, sort: nextSort, search: nextSearch });
    },
    [clearDir, loadDir, queuePendingJump, searchValue, sortState],
  );

  const navigateTo = useCallback(
    (path: string, options: ListDirOptions | undefined, source: "navigate" | "switch") => {
      const resolvedTabId = ensureActiveTab(path);
      const skipHistory = skipHistoryRef.current;
      if (skipHistory) {
        skipHistoryRef.current = false;
      } else if (source === "navigate" && resolvedTabId) {
        const currentForHistory = activeTab?.path ?? currentPath;
        recordHistory(resolvedTabId, currentForHistory, path);
      }
      performNavigation(path, options, source, resolvedTabId);
    },
    [activeTab?.path, currentPath, ensureActiveTab, performNavigation, recordHistory],
  );

  // jumpTo = explicit navigation (drives, path bar, recent jumps).
  const jumpTo = useCallback(
    (path: string, options?: ListDirOptions) => {
      navigateTo(path, options, "navigate");
    },
    [navigateTo],
  );
  // browseTo = in-view navigation (clicking folders in the current view).
  // It currently shares the same behavior as jumpTo, but the alias keeps intent clear.
  const browseTo = jumpTo;

  const updateActiveTab = useCallback(
    (patch: Partial<Tab>) => {
      if (!activeTabId) return;
      setTabs((prev) =>
        prev.map((tab) => (tab.id === activeTabId ? { ...tab, ...patch } : tab)),
      );
    },
    [activeTabId, setTabs],
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
      setTabs((prev) => {
        const index = activeTabId ? prev.findIndex((tab) => tab.id === activeTabId) : -1;
        const insertIndex = index >= 0 ? index + 1 : prev.length;
        // Insert to the right of the current tab so middle-click feels predictable.
        const next = [...prev];
        next.splice(insertIndex, 0, nextTab);
        return next;
      });
      setActiveTabId(nextTab.id);
      skipHistoryRef.current = true;
      jumpTo(target, { sort: nextTab.sort, search: nextTab.search });
    },
    [activeTabId, defaultTabState, jumpTo, setActiveTabId, setTabs, sortState, viewMode],
  );

  const goBack = useCallback(() => {
    if (!activeTabId) return;
    const current = activeTab?.path ?? currentPath;
    const next = popBack(activeTabId, current);
    if (!next) return;
    performNavigation(next, { sort: sortState, search: searchValue }, "navigate", activeTabId);
  }, [
    activeTab?.path,
    activeTabId,
    currentPath,
    popBack,
    performNavigation,
    searchValue,
    sortState,
  ]);

  const goForward = useCallback(() => {
    if (!activeTabId) return;
    const current = activeTab?.path ?? currentPath;
    const next = popForward(activeTabId, current);
    if (!next) return;
    performNavigation(next, { sort: sortState, search: searchValue }, "navigate", activeTabId);
  }, [
    activeTab?.path,
    activeTabId,
    currentPath,
    popForward,
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
        if (!emptyTabIdsRef.current.has(selected.id)) {
          emptyTabIdsRef.current.add(selected.id);
        }
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
      // Run tab-switch navigation immediately so cache hits paint without transition lag.
      navigateTo(selected.path, { sort: selected.sort, search: selected.search }, "switch");
    },
    [clearDir, navigateTo, setActiveTabId, setTabs, shouldLoadPath, tabs],
  );

  const closeTab = useCallback(
    (id: string) => {
      log("close tab -> %s", id);
      emptyTabIdsRef.current.delete(id);
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return;
      const nextTabs = tabs.filter((tab) => tab.id !== id);
      setTabs(nextTabs);

      if (nextTabs.length === 0) {
        pendingTabPathRef.current = null;
        setActiveTabId(null);
        clearDir({ silent: true });
        return;
      }

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

  const removeRecentJump = useCallback(
    (path: string) => {
      const key = normalizePath(path);
      if (!key) return;
      // Recent entries are keyed by normalized path so duplicates collapse consistently.
      setRecentJumps((prev) => prev.filter((item) => normalizePath(item) !== key));
    },
    [setRecentJumps],
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
    removeRecentJump,
  };
};
