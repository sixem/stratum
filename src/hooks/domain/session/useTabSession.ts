// Orchestrates tab state, view settings, and navigation flows.
import { useCallback, useLayoutEffect, useMemo } from "react";
import { shallow } from "zustand/shallow";
import type { ListDirOptions, SortState, Tab, ViewMode } from "@/types";
import type { TabHistoryDirection, TabTransfer } from "@/types/tabs";
import { DEFAULT_TAB_STATE, makeDebug, folderPathKey, getNextTrailPath } from "@/lib";
import { firstUnanchoredTabIndex, reorderTabs as reorderTabList } from "@/lib/tabAnchors";
import { useSessionStore } from "@/modules";
import { createSessionTab, createTerminalSessionTab, folderWithoutTerminal, useBottomSessionStore } from "@/modules/sessionStore";
import { registerShellNavigation, rememberShellDirectory } from "@/modules/terminalSplit";
import { resolveDefaultViewMode, useSettingsStore } from "@/modules/settings.store";
import { beginLinkedNavigation, closeLinkedTab, registerPaneLinkReceiver } from "@/modules/paneLinkNavigation";
import type { LinkedNavigation } from "@/modules/paneLinkNavigation";
import type { LoadDirOptions } from "@/hooks/domain/filesystem/fileManager.types";
import { useTabHistory } from "./tabHistory";
import { removeRecentJump, usePendingJump, useRecentJumps } from "./tabNavigation";
import { useTabPersistence } from "./useTabPersistence";

type TabSessionOptions = {
  useStore?: typeof useSessionStore;
  currentPath: string;
  loadingPath: string | null;
  loadDir: (path: string, options?: LoadDirOptions) => Promise<void>;
  clearDir: (options?: { silent?: boolean }) => void;
  keepFilterOnNavigation: boolean;
};

const log = makeDebug("tabs");
const CLOSED_TAB_LIMIT = 20;

export type OpenNewTabOptions = {
  background?: boolean;
  revealPath?: string;
};

export const useTabSession = ({
  useStore = useSessionStore,
  currentPath,
  loadingPath,
  loadDir,
  clearDir,
  keepFilterOnNavigation,
}: TabSessionOptions) => {
  const pane = useStore === useBottomSessionStore ? "bottom" : "main";
  const defaultViewMode = useSettingsStore(resolveDefaultViewMode);
  const recentJumpsLimit = useSettingsStore((state) => state.sidebarRecentLimit);
  const newTabSort = useSettingsStore((state) => state.newTabSort);
  const {
    tabs,
    activeTabId,
    restoreRevision,
    setTabs,
    setTabSearch,
    setActiveTabId,
    setRecentJumps,
    setTabScrollTop,
  } = useStore(
    (state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      restoreRevision: state.restoreRevision,
      setTabs: state.setTabs,
      setTabSearch: state.setTabSearch,
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
  const viewMode = activeTab?.viewMode ?? defaultViewMode;
  const sortState = activeTab?.sort ?? newTabSort ?? DEFAULT_TAB_STATE.sort;
  // Keep search filters tied to their owning tab.
  const searchValue = activeTab?.search ?? DEFAULT_TAB_STATE.search;
  const safeRecentLimit = Number.isFinite(recentJumpsLimit)
    ? Math.max(1, Math.round(recentJumpsLimit))
    : 1;

  const visibleRecentJumps = useRecentJumps(safeRecentLimit);

  const pathForHistory = loadingPath ?? (activeTab?.path || currentPath);
  // History and pending-jump tracking live in focused hooks to keep this file readable.
  const { canGoBack, canGoForward, recordHistory, getHistoryPaths, jumpHistory, takeHistory, restoreHistory } =
    useTabHistory({ tabs, activeTabId });
  const { queuePendingJump, shouldSyncEmptyTab } = usePendingJump({
    activeTabId,
    currentPath,
    recentLimit: safeRecentLimit,
  });
  const { emptyTabIdsRef, pendingNavigationRef, restoringTabs } = useTabPersistence({
    tabs,
    activeTabId,
    activeTab,
    currentPath,
    loadingPath,
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
    !(pendingNavigation.waitForListing && loadingPath) &&
    folderPathKey(pendingNavigation.path) === folderPathKey(displayPath)
    ? pendingNavigation.revealPath
    : null;

  const ensureActiveTab = useCallback(
    (path: string) => {
      if (activeTab && !activeTab.terminal) return activeTab.id;
      const next = createSessionTab(path, { sort: sortState, search: activeTab?.terminal ? "" : searchValue });
      const session = useStore.getState();
      session.updateSession({ tabs: [...session.tabs, next], activeTabId: next.id });
      return next.id;
    },
    [activeTab, searchValue, sortState, useStore],
  );

  const performNavigation = useCallback(
    (
      path: string,
      options: LoadDirOptions | undefined,
      source: "navigate" | "switch",
      tabId: string | null,
      details?: { linked?: LinkedNavigation; revealPath?: string; resetFilter?: boolean },
    ) => {
      const { linked, revealPath: entryToReveal } = details ?? {};
      const target = path.trim();
      if (!target) {
        pendingNavigationRef.current = null;
        clearDir();
        return;
      }
      const tab = useStore.getState().tabs.find(({ id }) => id === tabId);
      const shouldResetFilter = details?.resetFilter ?? (source === "navigate" && !keepFilterOnNavigation);
      const resetFilter = shouldResetFilter
        && tab?.search && options?.search === undefined
        && folderPathKey(tab.path) !== folderPathKey(target)
        ? { tabId: tab.id, previousSearch: tab.search }
        : undefined;
      // On an upward navigation, reveal the first folder on the way back to
      // the listing we are leaving, including when skipping several ancestors.
      const revealPath = entryToReveal ?? (source === "navigate" && tabId === activeTabId
        ? getNextTrailPath(target, currentPath)
        : null);
      const notifyLink = !linked && source === "navigate" ? beginLinkedNavigation(pane, tabId, target) : undefined;
      const prepare = () => {
        if (source === "navigate" && tabId) {
          emptyTabIdsRef.current.delete(tabId);
          if (linked) recordHistory(tabId, currentPath, target);
        }
        pendingNavigationRef.current = {
          tabId, path: target, sort: options?.sort, search: options?.search,
          resetFilter, revealPath, waitForListing: Boolean(entryToReveal), notifyLink,
        };
        queuePendingJump(target, source, tabId);
      };
      const nextSort = options?.sort ?? tab?.sort ?? sortState;
      const nextSearch = resetFilter ? "" : options?.search ?? tab?.search ?? searchValue;
      if (!linked) prepare();
      void loadDir(target, {
        ...options, sort: nextSort, search: nextSearch,
        force: entryToReveal ? true : options?.force,
        linked: linked ? { ...linked, onCommit: prepare } : undefined,
      });
    },
    [
      activeTabId, clearDir, currentPath, emptyTabIdsRef, keepFilterOnNavigation, loadDir, pane, pendingNavigationRef,
      queuePendingJump, recordHistory, searchValue, sortState, useStore,
    ],
  );

  useLayoutEffect(() => registerPaneLinkReceiver(pane, (target, linked) => {
    const session = useStore.getState();
    const tab = session.tabs.find(({ id }) => id === session.activeTabId);
    if (tab && !tab.terminal && folderPathKey(tab.path) === folderPathKey(currentPath)) {
      performNavigation(target, undefined, "navigate", tab.id, { linked });
    }
  }), [currentPath, pane, performNavigation, useStore]);

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

  useLayoutEffect(() => registerShellNavigation(pane, (tab, path) => {
    if (folderPathKey(tab.path) === folderPathKey(path)) return;
    recordHistory(tab.id, tab.path, path);
    if (useStore.getState().activeTabId !== tab.id) {
      rememberShellDirectory(pane, tab.id, path);
    } else {
      performNavigation(path, undefined, "navigate", tab.id);
    }
  }), [pane, performNavigation, recordHistory, useStore]);

  const updateActiveTab = useCallback(
    (patch: Partial<Pick<Tab, "viewMode" | "sort">>) => {
      if (!activeTabId) return;
      setTabs((prev) =>
        prev.map((tab) => (tab.id === activeTabId ? { ...tab, ...patch } : tab)),
      );
    },
    [activeTabId, setTabs],
  );

  const openEmptyTab = useCallback((initialView?: ViewMode, terminalDirectory?: string) => {
    log("new tab -> empty");
    const nextTab = terminalDirectory === undefined
      ? createSessionTab("", { sort: sortState }) : createTerminalSessionTab(terminalDirectory);
    if (initialView) nextTab.viewMode = initialView;
    emptyTabIdsRef.current.add(nextTab.id);
    pendingNavigationRef.current = null;
    const session = useStore.getState();
    session.updateSession({ tabs: [...session.tabs, nextTab], activeTabId: nextTab.id });
    clearDir({ silent: true });
  }, [clearDir, emptyTabIdsRef, pendingNavigationRef, sortState, useStore]);

  const newPowerShellTab = () => openEmptyTab(undefined, activeTab?.terminal?.directory ?? displayPath);
  const newTab = useCallback(() => openEmptyTab(), [openEmptyTab]);

  const setViewMode = useCallback(
    (nextView: ViewMode) => {
      log("view mode -> %s", nextView);
      const settings = useSettingsStore.getState();
      if (settings.lastUsedViewMode !== nextView) settings.updateSettings({ lastUsedViewMode: nextView });
      if (activeTabId) updateActiveTab({ viewMode: nextView });
      else if (viewMode !== nextView) openEmptyTab(nextView);
    },
    [activeTabId, openEmptyTab, updateActiveTab, viewMode],
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
      if (activeTabId) setTabSearch(activeTabId, search);
    },
    [activeTabId, setTabSearch],
  );

  const openInNewTab = useCallback(
    (path: string, options?: OpenNewTabOptions) => {
      const target = path.trim();
      if (!target) return;
      log("open in new tab -> %s", target);
      const nextTab = createSessionTab(target, { sort: sortState });
      emptyTabIdsRef.current.delete(nextTab.id);
      setTabs((prev) => {
        const index = activeTabId ? prev.findIndex((tab) => tab.id === activeTabId) : -1;
        const insertIndex = index >= 0 ? index + 1 : prev.length;
        // Insert to the right of the current tab so middle-click feels predictable.
        const next = [...prev];
        next.splice(insertIndex, 0, nextTab);
        return next;
      });
      // Selecting the tab later uses the regular navigation path.
      if (options?.background) return;
      setActiveTabId(nextTab.id);
      performNavigation(target, { sort: nextTab.sort, search: nextTab.search }, "navigate", nextTab.id, {
        revealPath: options?.revealPath,
      });
    },
    [activeTabId, performNavigation, setActiveTabId, setTabs, sortState],
  );

  const openInBackgroundTab = useCallback(
    (path: string) => openInNewTab(path, { background: true }),
    [openInNewTab],
  );

  const getActiveHistoryPaths = useCallback((direction: TabHistoryDirection) => (
    activeTabId ? getHistoryPaths(activeTabId, direction) : []
  ), [activeTabId, getHistoryPaths]);

  const navigateHistory = useCallback((
    direction: TabHistoryDirection,
    offset = 0,
    expectedPath?: string,
  ) => {
    // An open menu belongs to the tab that supplied its history entries.
    if (!activeTabId || useStore.getState().activeTabId !== activeTabId) return;
    const next = jumpHistory(activeTabId, direction, pathForHistory, offset, expectedPath);
    if (next) performNavigation(next, undefined, "navigate", activeTabId);
  }, [activeTabId, jumpHistory, pathForHistory, performNavigation, useStore]);

  const goBack = useCallback(() => navigateHistory("back"), [navigateHistory]);
  const goForward = useCallback(() => navigateHistory("forward"), [navigateHistory]);

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

  const removeTab = useCallback(
    (id: string, scrollTop?: number, receive?: (transfer: TabTransfer) => boolean) => {
      // The UI may have just saved the outgoing scroll position.
      const session = useStore.getState();
      const index = session.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return;
      const tab = session.tabs[index];
      if (tab.anchored) return;
      const savedTab = scrollTop !== undefined && Number.isFinite(scrollTop)
        ? { ...tab, scrollTop: Math.max(0, Math.round(scrollTop)) }
        : tab;
      const history = takeHistory(id);
      const wasActive = id === session.activeTabId;
      const pending = pendingNavigationRef.current;
      const navigation = receive && wasActive && pending?.tabId === id &&
        folderPathKey(loadingPath ?? currentPath) === folderPathKey(pending.path)
        ? {
          path: pending.path, sort: pending.sort, search: pending.search,
          revealPath: pending.revealPath ?? undefined,
          resetFilter: pending.resetFilter?.previousSearch === tab.search,
        }
        : undefined;
      // A move only removes the original once the other pane owns the tab.
      if (receive && !receive({ tab: savedTab, history, navigation })) {
        if (history) restoreHistory(id, history);
        return;
      }
      closeLinkedTab(pane, id);
      log("%s tab -> %s", receive ? "move" : "close", id);
      emptyTabIdsRef.current.delete(id);
      const nextTabs = session.tabs.filter((tab) => tab.id !== id);
      const fallback = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
      session.updateSession({
        tabs: nextTabs,
        activeTabId: wasActive || !fallback ? fallback?.id ?? null : session.activeTabId,
        ...(receive || tab.terminal ? {} : { closedTabs: [{ tab: folderWithoutTerminal(savedTab), history, index }, ...session.closedTabs].slice(0, CLOSED_TAB_LIMIT) }),
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
    [clearDir, currentPath, emptyTabIdsRef, loadingPath, pane, pendingNavigationRef, performNavigation,
      restoreHistory, takeHistory, useStore],
  );

  const closeTab = useCallback((id: string, scrollTop?: number) => removeTab(id, scrollTop), [removeTab]);
  const moveTab = useCallback((id: string, receive: (transfer: TabTransfer) => boolean, scrollTop?: number) =>
    removeTab(id, scrollTop, receive), [removeTab]);

  const activateStoredTab = useCallback((tab: Tab, navigation?: TabTransfer["navigation"]) => {
    if (navigation) {
      const { path, sort, search, revealPath, resetFilter } = navigation;
      performNavigation(path, { sort, search }, "switch", tab.id, { revealPath, resetFilter });
      return;
    }
    if (!tab.path.trim()) {
      emptyTabIdsRef.current.add(tab.id);
      pendingNavigationRef.current = null;
      clearDir({ silent: true });
    } else {
      performNavigation(tab.path, { sort: tab.sort, search: tab.search }, "switch", tab.id);
    }
  }, [clearDir, emptyTabIdsRef, pendingNavigationRef, performNavigation]);

  const receiveTab = useCallback(({ tab, history, navigation }: TabTransfer, toIndex: number) => {
    if (tab.anchored) return false;
    const session = useStore.getState();
    const idInUse = session.tabs.some(({ id }) => id === tab.id) ||
      session.closedTabs.some((closed) => closed.tab.id === tab.id);
    const incoming = idInUse ? { ...tab, id: createSessionTab(tab.path).id } : tab;
    const nextTabs = [...session.tabs];
    nextTabs.splice(Math.min(Math.max(toIndex, firstUnanchoredTabIndex(nextTabs)), nextTabs.length), 0, incoming);
    session.updateSession({ tabs: nextTabs, activeTabId: incoming.id });
    if (history) restoreHistory(incoming.id, history);
    activateStoredTab(incoming, navigation);
    return true;
  }, [activateStoredTab, restoreHistory, useStore]);

  const endTerminalSplit = (id: string, keep: "both" | "folder" | "terminal") => {
    const session = useStore.getState();
    const index = session.tabs.findIndex(tab => tab.id === id);
    const folder = session.tabs[index];
    if (!folder?.split || (folder.anchored && keep === "terminal")) return;
    const next = [...session.tabs];
    next[index] = folderWithoutTerminal(folder);
    const keepShellActive = keep === "terminal" && session.activeTabId === id;
    if (keep === "folder") {
      session.setTabs(next);
      return;
    }
    const shell = createTerminalSessionTab(folder.split.terminal);
    next.splice(Math.max(index + 1, firstUnanchoredTabIndex(next)), 0, shell);
    session.updateSession({ tabs: next, activeTabId: keepShellActive ? shell.id : session.activeTabId });
    if (keep === "terminal") {
      closeTab(id);
      if (keepShellActive) activateStoredTab(shell);
    }
  };

  const reopenClosedTab = useCallback(() => {
    const session = useStore.getState();
    const [closed, ...remainingClosedTabs] = session.closedTabs;
    if (!closed) return false;

    const { tab, index, history } = closed;
    const nextTabs = [...session.tabs];
    nextTabs.splice(Math.min(Math.max(index, firstUnanchoredTabIndex(nextTabs)), nextTabs.length), 0, tab);
    session.updateSession({ tabs: nextTabs, activeTabId: tab.id, closedTabs: remainingClosedTabs });
    if (history) restoreHistory(tab.id, history);
    activateStoredTab(tab);
    return true;
  }, [activateStoredTab, restoreHistory, useStore]);

  const reorderTabs = useCallback(
    (fromId: string, toIndex: number) => {
      setTabs((prev) => reorderTabList(prev, fromId, toIndex));
    },
    [setTabs],
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
    getActiveHistoryPaths,
    navigateHistory,
    jumpTo,
    browseTo,
    setViewMode,
    setSort,
    setSearch,
    goBack,
    goForward,
    newTab,
    newPowerShellTab,
    endTerminalSplit,
    openInNewTab,
    openInBackgroundTab,
    selectTab,
    closeTab,
    moveTab,
    receiveTab,
    reopenClosedTab,
    reorderTabs,
    setTabScrollTop,
    removeRecentJump,
  };
};
