// Keeps tab state synced with the current path and persisted history.
import { useEffect, useRef } from "react";
import type { ListDirOptions, SortState, Tab } from "@/types";
import { normalizePath } from "@/lib";

type SetTabs = (next: Tab[] | ((prev: Tab[]) => Tab[])) => void;

type SetRecentJumps = (next: string[] | ((prev: string[]) => string[])) => void;

type UseTabPersistenceOptions = {
  tabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | null;
  currentPath: string;
  sortState: SortState;
  searchValue: string;
  loadDir: (path: string, options?: ListDirOptions) => Promise<void>;
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

export const useTabPersistence = ({
  tabs,
  activeTabId,
  activeTab,
  currentPath,
  sortState,
  searchValue,
  loadDir,
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
  const suppressTabSyncRef = useRef(Boolean(restorePathRef.current));
  // Hold target path after tab switches to avoid transient path flicker.
  const pendingTabPathRef = useRef<string | null>(null);

  useEffect(() => {
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
  }, [activeTab, activeTabId, currentPath, setTabs, shouldSyncEmptyTab]);

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
    setRecentJumps((prev) => {
      if (prev.length <= recentLimit) return prev;
      return prev.slice(0, recentLimit);
    });
  }, [recentLimit, setRecentJumps]);

  return { emptyTabIdsRef, pendingTabPathRef };
};
