import { resolveCrumbTrailPath } from "@/lib/crumbTrail";
// Keeps tab state synced with the current path and persisted history.
import { useEffect, useLayoutEffect, useRef } from "react";
import type { SortState, Tab } from "@/types";
import type { LoadDirOptions } from "@/hooks/domain/filesystem/fileManager.types";
import { folderPathKey } from "@/lib";
import { subscribeToFolderRename } from "@/modules/renamedFolderLocations";

type SetTabs = (next: Tab[] | ((prev: Tab[]) => Tab[])) => void;

type SetRecentJumps = (next: string[] | ((prev: string[]) => string[])) => void;

type PendingNavigation = {
  tabId: string | null;
  path: string;
  sort?: SortState;
  search?: string;
  revealPath?: string | null;
  waitForListing?: boolean;
  resetFilter?: { tabId: string; previousSearch: string };
  notifyLink?: () => void;
};

type UseTabPersistenceOptions = {
  tabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  currentPath: string;
  loadingPath: string | null;
  sortState: SortState;
  searchValue: string;
  loadDir: (path: string, options?: LoadDirOptions) => Promise<void>;
  clearDir: (options?: { silent?: boolean }) => void;
  restoreRevision: number;
  setTabs: SetTabs;
  setRecentJumps: SetRecentJumps;
  recentLimit: number;
  shouldSyncEmptyTab: (tabId: string) => boolean;
};

export const useTabPersistence = ({
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
  recentLimit,
  shouldSyncEmptyTab,
}: UseTabPersistenceOptions) => {
  // Track tabs that should stay empty until the user navigates inside them.
  const emptyTabIdsRef = useRef<Set<string>>(new Set());
  const restorePathRef = useRef<string | null>(
    tabs.find((tab) => tab.id === activeTabId)?.path ?? null,
  );
  const restoreRequestedRef = useRef(false);
  const appliedRevisionRef = useRef(restoreRevision);
  // Hold the target until its listing commits, including any pending filter reset.
  const pendingNavigationRef = useRef<PendingNavigation | null>(null);

  useLayoutEffect(() => subscribeToFolderRename((mapPath) => {
    const pending = pendingNavigationRef.current;
    if (pending?.revealPath) pending.revealPath = mapPath(pending.revealPath);
    const path = pending?.path ?? loadingPath ?? activeTab?.path;
    if (!path) return;
    const nextPath = mapPath(path);
    if (path === nextPath) return;
    pendingNavigationRef.current = { ...pending, tabId: activeTabId, path: nextPath };
    void loadDir(nextPath, {
      sort: pending?.sort ?? sortState,
      search: pending?.resetFilter ? "" : pending?.search ?? searchValue,
      force: true,
    });
  }), [activeTab?.path, activeTabId, loadDir, loadingPath, searchValue, sortState]);

  useLayoutEffect(() => {
    if (appliedRevisionRef.current !== restoreRevision) {
      appliedRevisionRef.current = restoreRevision;
      restorePathRef.current = null;
      emptyTabIdsRef.current.clear();
      // Invalidate the outgoing request before it can write into the new tabs.
      clearDir({ silent: true });
      const path = activeTab?.path.trim();
      pendingNavigationRef.current = path ? { path, tabId: activeTabId } : null;
      if (path && activeTab) {
        void loadDir(path, { sort: activeTab.sort, search: activeTab.search });
      } else if (activeTabId) {
        emptyTabIdsRef.current.add(activeTabId);
      }
      return;
    }
    // Keep the active tab path synced with the current directory.
    if (!currentPath && activeTabId) return;
    if (!activeTabId) return;
    // Avoid "stealing" a path for untitled tabs unless we explicitly navigated in them.
    const allowEmptyTabSync = shouldSyncEmptyTab(activeTabId);
    const isExplicitEmptyTab = Boolean(
      activeTab && emptyTabIdsRef.current.has(activeTab.id),
    );
    if (isExplicitEmptyTab && currentPath.trim() && !allowEmptyTabSync) {
      return;
    }
    const pending = pendingNavigationRef.current;
    if (pending) {
      // An explicit output reveal can target the current folder, whose
      // displayed listing may still be missing the newly written entry.
      if (pending.waitForListing && loadingPath) return;
      const pendingKey = folderPathKey(pending.path);
      const currentKey = folderPathKey(currentPath);
      if (pendingKey && currentKey && pendingKey !== currentKey) {
        return;
      }
      pendingNavigationRef.current = null;
    }
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === activeTabId);
      if (index === -1) return prev;
      const tab = prev[index];
      if (tab.kind !== "folder") return prev;
      // A search entered during the load belongs to the newly opened folder.
      const reset = pending?.resetFilter;
      const nextSearch =
        reset?.tabId === tab.id && tab.search === reset.previousSearch ? "" : tab.search;
      // Update the crumb trail so breadcrumb "future" crumbs stay visible.
      const nextTrailPath = resolveCrumbTrailPath(
        currentPath,
        tab.crumbTrailPath ?? tab.path,
      );
      if (tab.path === currentPath && tab.crumbTrailPath === nextTrailPath && tab.search === nextSearch) {
        // Avoid re-setting identical paths to prevent update loops.
        return prev;
      }
      const next = [...prev];
      next[index] = {
        ...tab,
        path: currentPath,
        crumbTrailPath: nextTrailPath,
        search: nextSearch,
        // The folder reveal supplies the new offset. Do not restore an offset from the child.
        scrollTop: pending?.revealPath ? 0 : tab.scrollTop,
      };
      return next;
    });
    pending?.notifyLink?.();
  }, [activeTab, activeTabId, clearDir, currentPath, loadDir, loadingPath, restoreRevision, setTabs, shouldSyncEmptyTab]);

  useEffect(() => {
    // Restore the last active tab path once on startup.
    const target = restorePathRef.current;
    if (!target || restoreRequestedRef.current) return;
    const targetKey = folderPathKey(target);
    const currentKey = folderPathKey(currentPath);
    if (!targetKey || targetKey === currentKey) {
      restorePathRef.current = null;
      return;
    }
    restoreRequestedRef.current = true;
    pendingNavigationRef.current = { path: target, tabId: activeTabId };
    void loadDir(target, { sort: sortState, search: searchValue });
  }, [activeTabId, currentPath, loadDir, searchValue, sortState]);

  useEffect(() => {
    setRecentJumps((prev) => {
      if (prev.length <= recentLimit) return prev;
      return prev.slice(0, recentLimit);
    });
  }, [recentLimit, setRecentJumps]);

  return { emptyTabIdsRef, pendingNavigationRef, restoringTabs: appliedRevisionRef.current !== restoreRevision };
};
