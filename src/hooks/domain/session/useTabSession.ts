// Orchestrates tab state, view settings, and navigation flows.
import { useCallback, useMemo } from "react";
import { shallow } from "zustand/shallow";
import type { ListDirOptions, SortState, Tab, ViewMode } from "@/types";
import { DEFAULT_TAB_STATE, makeDebug, folderPathKey, getNextTrailPath } from "@/lib";
import { useSessionStore } from "@/modules";
import { createSessionTab } from "@/modules/sessionStore";
import { useTabHistory } from "./tabHistory";
import { usePendingJump } from "./tabNavigation";
import { useTabPersistence } from "./useTabPersistence";

type TabSessionOptions = {
  useStore?: typeof useSessionStore;
  currentPath: string;
  loadingPath: string | null;
  loadDir: (path: string, options?: ListDirOptions) => Promise<void>;
  clearDir: (options?: { silent?: boolean }) => void;
  defaultViewMode: ViewMode;
  newTabViewMode?: ViewMode;
  keepFilterOnNavigation: boolean;
  recentJumpsLimit: number;
};

const log = makeDebug("tabs");
const CLOSED_TAB_LIMIT = 20;

export const useTabSession = ({
  useStore = useSessionStore,
  currentPath,
  loadingPath,
  loadDir,
  clearDir,
  defaultViewMode,
  newTabViewMode,
  keepFilterOnNavigation,
  recentJumpsLimit,
}: TabSessionOptions) => {
  const {
    tabs,
    activeTabId,
    recentJumps,
    restoreRevision,
    setTabs,
    setActiveTabId,
    setRecentJumps,
    setTabScrollTop,
  } = useStore(
    (state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      recentJumps: state.recentJumps,
      restoreRevision: state.restoreRevision,
      setTabs: state.setTabs,
      setActiveTabId: state.setActiveTabId,
      setRecentJumps: state.setRecentJumps,
      setTabScrollTop: state.setTabScrollTop,
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
  const nextViewMode = newTabViewMode ?? viewMode;
  const sortState = activeTab?.sort ?? defaultTabState.sort;
  // Keep search filters tied to their owning tab.
  const searchValue = activeTab?.search ?? defaultTabState.search;
  const safeRecentLimit = Number.isFinite(recentJumpsLimit)
    ? Math.max(1, Math.round(recentJumpsLimit))
    : 1;

  const visibleRecentJumps = useMemo(
    () => recentJumps.length <= safeRecentLimit ? recentJumps : recentJumps.slice(0, safeRecentLimit),
    [recentJumps, safeRecentLimit],
  );

  const pathForHistory = loadingPath ?? (activeTab?.path || currentPath);
  // History and pending-jump tracking live in focused hooks to keep this file readable.
  const { canGoBack, canGoForward, recordHistory, popBack, popForward, takeHistory, restoreHistory } =
    useTabHistory({ tabs, activeTabId });
  const { queuePendingJump, shouldSyncEmptyTab } = usePendingJump({
    activeTabId,
    currentPath,
    recentLimit: safeRecentLimit,
    setRecentJumps,
  });
  const { emptyTabIdsRef, pendingNavigationRef, restoringTabs } = useTabPersistence({
    tabs,
    activeTabId,
    activeTab,
    currentPath,
    sortState,
    searchValue,
    loadDir,
    clearDir,
    restoreRevision,
    setTabs,
    setRecentJumps,
    recentLimit: safeRecentLimit,
    shouldSyncEmptyTab,
  });
  // The folder snapshot can commit one render before its tab is persisted.
  // Keep the submitted target in the address bar across both renders.
  const pendingNavigation = restoringTabs ? null : pendingNavigationRef.current;
  const requestedPath = pendingNavigation?.path;
  const requestedPathIsDisplayed = requestedPath &&
    folderPathKey(requestedPath) === folderPathKey(currentPath);
  // The outgoing loader can still report a path until the restore layout effect runs.
  const displayPath = restoringTabs ? activeTab?.path ?? "" : loadingPath ?? (
    requestedPathIsDisplayed ? currentPath : activeTab?.path || currentPath
  );
  // Look up cached results with the destination filter while the tab still shows its old search.
  const displaySearch = requestedPath === displayPath && pendingNavigation?.resetFilter
    ? ""
    : searchValue;
  const navigationRevealPath = pendingNavigation?.revealPath &&
    folderPathKey(pendingNavigation.path) === folderPathKey(displayPath)
    ? pendingNavigation.revealPath
    : null;

  const ensureActiveTab = useCallback(
    (path: string) => {
      if (activeTabId) return activeTabId;
      const fallback = tabs[0];
      if (fallback) {
        setActiveTabId(fallback.id);
        return fallback.id;
      }
      const nextTab = createSessionTab(
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
        pendingNavigationRef.current = null;
        clearDir();
        return;
      }
      if (source === "navigate" && tabId) {
        emptyTabIdsRef.current.delete(tabId);
      }
      const tab = useStore.getState().tabs.find(({ id }) => id === tabId);
      const resetFilter = source === "navigate" && !keepFilterOnNavigation
        && tab?.search && options?.search === undefined
        && folderPathKey(tab.path) !== folderPathKey(target)
        ? { tabId: tab.id, previousSearch: tab.search }
        : undefined;
      // On an upward navigation, reveal the first folder on the way back to
      // the listing we are leaving, including when skipping several ancestors.
      const revealPath = source === "navigate" && tabId === activeTabId
        ? getNextTrailPath(target, currentPath)
        : null;
      pendingNavigationRef.current = { path: target, resetFilter, revealPath };
      queuePendingJump(target, source, tabId);
      const nextSort = options?.sort ?? tab?.sort ?? sortState;
      const nextSearch = resetFilter ? "" : options?.search ?? tab?.search ?? searchValue;
      void loadDir(target, { ...options, sort: nextSort, search: nextSearch });
    },
    [
      activeTabId, clearDir, currentPath, emptyTabIdsRef, keepFilterOnNavigation, loadDir, pendingNavigationRef,
      queuePendingJump, searchValue, sortState, useStore,
    ],
  );

  const jumpTo = useCallback(
    (path: string, options?: ListDirOptions) => {
      const resolvedTabId = ensureActiveTab(path);
      if (resolvedTabId) recordHistory(resolvedTabId, pathForHistory, path);
      performNavigation(path, options, "navigate", resolvedTabId);
    },
    [ensureActiveTab, pathForHistory, performNavigation, recordHistory],
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
    const nextTab = createSessionTab("", { viewMode: nextViewMode, sort: sortState }, defaultTabState);
    emptyTabIdsRef.current.add(nextTab.id);
    pendingNavigationRef.current = null;
    setTabs((prev) => [...prev, nextTab]);
    setActiveTabId(nextTab.id);
    clearDir({ silent: true });
  }, [clearDir, defaultTabState, setActiveTabId, setTabs, sortState, nextViewMode]);

  const openInNewTab = useCallback(
    (path: string) => {
      const target = path.trim();
      if (!target) return;
      log("open in new tab -> %s", target);
      const nextTab = createSessionTab(target, { viewMode: nextViewMode, sort: sortState }, defaultTabState);
      emptyTabIdsRef.current.delete(nextTab.id);
      setTabs((prev) => {
        const index = activeTabId ? prev.findIndex((tab) => tab.id === activeTabId) : -1;
        const insertIndex = index >= 0 ? index + 1 : prev.length;
        // Insert to the right of the current tab so middle-click feels predictable.
        const next = [...prev];
        next.splice(insertIndex, 0, nextTab);
        return next;
      });
      setActiveTabId(nextTab.id);
      performNavigation(target, { sort: nextTab.sort, search: nextTab.search }, "navigate", nextTab.id);
    },
    [activeTabId, defaultTabState, performNavigation, setActiveTabId, setTabs, sortState, nextViewMode],
  );

  const goBack = useCallback(() => {
    if (!activeTabId) return;
    const next = popBack(activeTabId, pathForHistory);
    if (!next) return;
    performNavigation(next, undefined, "navigate", activeTabId);
  }, [
    activeTabId,
    pathForHistory,
    popBack,
    performNavigation,
  ]);

  const goForward = useCallback(() => {
    if (!activeTabId) return;
    const next = popForward(activeTabId, pathForHistory);
    if (!next) return;
    performNavigation(next, undefined, "navigate", activeTabId);
  }, [
    activeTabId,
    pathForHistory,
    popForward,
    performNavigation,
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
        pendingNavigationRef.current = null;
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
      setActiveTabId(id);
      // Let the loader decide whether the *query* is already displayed. Even a
      // tab at the same path must supersede a pending load for another folder.
      performNavigation(selected.path, { sort: selected.sort, search: selected.search }, "switch", id);
    },
    [clearDir, performNavigation, setActiveTabId, setTabs, tabs],
  );

  const closeTab = useCallback(
    (id: string, scrollTop?: number) => {
      // The UI may have just saved the outgoing scroll position.
      const session = useStore.getState();
      const index = session.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return;

      log("close tab -> %s", id);
      const tab = session.tabs[index];
      const savedTab = scrollTop !== undefined && Number.isFinite(scrollTop)
        ? { ...tab, scrollTop: Math.max(0, Math.round(scrollTop)) }
        : tab;
      const closed = { tab: savedTab, index, history: takeHistory(id) };
      emptyTabIdsRef.current.delete(id);
      const nextTabs = session.tabs.filter((tab) => tab.id !== id);
      const wasActive = id === session.activeTabId;
      const fallback = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
      session.updateSession({
        tabs: nextTabs,
        activeTabId: wasActive || !fallback ? fallback?.id ?? null : session.activeTabId,
        closedTabs: [closed, ...session.closedTabs].slice(0, CLOSED_TAB_LIMIT),
      });

      if (!fallback || (wasActive && !fallback.path.trim())) {
        pendingNavigationRef.current = null;
        clearDir({ silent: true });
        return;
      }

      if (wasActive) {
        performNavigation(fallback.path, { sort: fallback.sort, search: fallback.search }, "switch", fallback.id);
      }
    },
    [clearDir, emptyTabIdsRef, pendingNavigationRef, performNavigation, takeHistory, useStore],
  );

  const reopenClosedTab = useCallback(() => {
    const session = useStore.getState();
    const [closed, ...remainingClosedTabs] = session.closedTabs;
    if (!closed) return false;

    const { tab, index, history } = closed;
    const nextTabs = [...session.tabs];
    nextTabs.splice(Math.min(index, nextTabs.length), 0, tab);
    const isEmpty = !tab.path.trim();
    if (isEmpty) {
      emptyTabIdsRef.current.add(tab.id);
      pendingNavigationRef.current = null;
    }
    session.updateSession({ tabs: nextTabs, activeTabId: tab.id, closedTabs: remainingClosedTabs });
    if (history) restoreHistory(tab.id, history);

    if (isEmpty) clearDir({ silent: true });
    else performNavigation(tab.path, { sort: tab.sort, search: tab.search }, "switch", tab.id);
    return true;
  }, [clearDir, emptyTabIdsRef, pendingNavigationRef, performNavigation, restoreHistory, useStore]);

  const reorderTabs = useCallback(
    (fromId: string, toIndex: number) => {
      setTabs((prev) => {
        const fromIndex = prev.findIndex((tab) => tab.id === fromId);
        if (fromIndex === -1) return prev;
        // The drop slot was measured with the dragged tab still in the strip.
        const adjustedIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
        const insertIndex = Math.min(Math.max(adjustedIndex, 0), prev.length - 1);
        if (insertIndex === fromIndex) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(insertIndex, 0, moved);
        return next;
      });
    },
    [setTabs],
  );

  const removeRecentJump = useCallback(
    (path: string) => {
      const key = folderPathKey(path);
      if (!key) return;
      // Recent entries are keyed by normalized path so duplicates collapse consistently.
      setRecentJumps((prev) => prev.filter((item) => folderPathKey(item) !== key));
    },
    [setRecentJumps],
  );

  return {
    tabs,
    activeTabId,
    recentJumps: visibleRecentJumps,
    activeTab,
    restoringTabs,
    displayPath,
    displaySearch,
    navigationRevealPath,
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
    reopenClosedTab,
    reorderTabs,
    setTabScrollTop,
    removeRecentJump,
  };
};
