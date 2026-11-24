// Keeps tab state synced with the current path and persisted history.
import { useEffect, useLayoutEffect, useRef } from "react";
import type { ListDirOptions, SortState, Tab } from "@/types";
import { folderPathKey } from "@/lib";

type SetTabs = (next: Tab[] | ((prev: Tab[]) => Tab[])) => void;

type SetRecentJumps = (next: string[] | ((prev: string[]) => string[])) => void;

type PendingNavigation = {
  path: string;
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
  loadDir: (path: string, options?: ListDirOptions) => Promise<void>;
  clearDir: (options?: { silent?: boolean }) => void;
  restoreRevision: number;
  setTabs: SetTabs;
  setRecentJumps: SetRecentJumps;
  recentLimit: number;
  shouldSyncEmptyTab: (tabId: string) => boolean;
};

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
  const currentKey = folderPathKey(trimmedCurrent);
  const trailKey = folderPathKey(trimmedTrail);
  if (!currentKey || !trailKey) return trimmedCurrent;
  if (currentKey === trailKey) return trimmedCurrent;
  // Keep the deepest path when navigating up within the same branch.
  if (isPathKeyPrefix(currentKey, trailKey)) return trimmedTrail;
  // Update the trail when navigating deeper under the same branch.
  if (isPathKeyPrefix(trailKey, currentKey)) return trimmedCurrent;
  // Reset the trail when the branch changes.
  return trimmedCurrent;
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

  useLayoutEffect(() => {
    if (appliedRevisionRef.current !== restoreRevision) {
      appliedRevisionRef.current = restoreRevision;
      restorePathRef.current = null;
      emptyTabIdsRef.current.clear();
      // Invalidate the outgoing request before it can write into the new tabs.
      clearDir({ silent: true });
      const path = activeTab?.path.trim();
      pendingNavigationRef.current = path ? { path } : null;
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
    pendingNavigationRef.current = { path: target };
    void loadDir(target, { sort: sortState, search: searchValue });
  }, [currentPath, loadDir, searchValue, sortState]);

  useEffect(() => {
    setRecentJumps((prev) => {
      if (prev.length <= recentLimit) return prev;
      return prev.slice(0, recentLimit);
    });
  }, [recentLimit, setRecentJumps]);

  return { emptyTabIdsRef, pendingNavigationRef, restoringTabs: appliedRevisionRef.current !== restoreRevision };
};
