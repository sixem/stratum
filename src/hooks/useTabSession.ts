// Orchestrates tab state, view settings, and navigation flows.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shallow } from "zustand/shallow";
import type { Place, SortState, Tab, ViewMode } from "@/types";
import { createTab, DEFAULT_TAB_STATE, normalizePath } from "@/lib";
import { useSessionStore } from "@/modules";

type TabSessionOptions = {
  currentPath: string;
  drives: string[];
  places: Place[];
  loadDir: (path: string) => Promise<void>;
  defaultViewMode: ViewMode;
  recentJumpsLimit: number;
};

export const useTabSession = ({
  currentPath,
  drives,
  places,
  loadDir,
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
      sidebarOpen: DEFAULT_TAB_STATE.sidebarOpen,
      sort: DEFAULT_TAB_STATE.sort,
    }),
    [defaultViewMode],
  );
  const viewMode = activeTab?.viewMode ?? defaultTabState.viewMode;
  const sidebarOpen = activeTab?.sidebarOpen ?? defaultTabState.sidebarOpen;
  const sortState = activeTab?.sort ?? defaultTabState.sort;
  const safeRecentLimit = Number.isFinite(recentJumpsLimit)
    ? Math.max(1, Math.round(recentJumpsLimit))
    : 1;

  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const pendingJumpSourceRef = useRef<"navigate" | "switch" | null>(null);
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

  useEffect(() => {
    // Keep the active tab path synced with the current directory.
    if (!currentPath) return;
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
      const nextTab = createTab(currentPath, undefined, defaultTabState);
      setTabs([nextTab]);
      setActiveTabId(nextTab.id);
      return;
    }
    setTabs((prev) =>
      prev.map((tab) => (tab.id === activeTabId ? { ...tab, path: currentPath } : tab)),
    );
  }, [activeTabId, currentPath, setActiveTabId, setTabs]);

  useEffect(() => {
    // Restore the last active tab path once on startup.
    const target = restorePathRef.current;
    if (!target || restoreRequestedRef.current || !currentPath) return;
    const targetKey = normalizePath(target);
    const currentKey = normalizePath(currentPath);
    if (!targetKey || targetKey === currentKey) {
      suppressTabSyncRef.current = false;
      restorePathRef.current = null;
      return;
    }
    restoreRequestedRef.current = true;
    void loadDir(target);
  }, [currentPath, loadDir]);

  useEffect(() => {
    // Update recent jumps after navigation completes.
    if (!pendingJump) return;
    if (pendingJumpSourceRef.current === "switch") {
      setPendingJump(null);
      pendingJumpSourceRef.current = null;
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
  }, [currentPath, pendingJump, safeRecentLimit, setRecentJumps]);

  useEffect(() => {
    setRecentJumps((prev) => {
      if (prev.length <= safeRecentLimit) return prev;
      return prev.slice(0, safeRecentLimit);
    });
  }, [safeRecentLimit, setRecentJumps]);

  const jumpTo = useCallback(
    (path: string) => {
      pendingJumpSourceRef.current = "navigate";
      setPendingJump(path);
      void loadDir(path);
    },
    [loadDir],
  );

  const browseTo = useCallback(
    (path: string) => {
      void loadDir(path);
    },
    [loadDir],
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

  const setViewMode = useCallback(
    (nextView: ViewMode) => {
      updateActiveTab({ viewMode: nextView });
    },
    [updateActiveTab],
  );

  const setSort = useCallback(
    (sort: SortState) => {
      updateActiveTab({ sort });
    },
    [updateActiveTab],
  );

  const toggleSidebar = useCallback(() => {
    if (!activeTab) return;
    updateActiveTab({ sidebarOpen: !activeTab.sidebarOpen });
  }, [activeTab, updateActiveTab]);

  const newTab = useCallback(() => {
    const basePath = currentPath || drives[0] || places[0]?.path;
    if (!basePath) return;
    const nextTab = createTab(basePath, activeTab ?? defaultTabState, defaultTabState);
    pendingTabPathRef.current = normalizePath(basePath) ?? basePath;
    setTabs((prev) => [...prev, nextTab]);
    setActiveTabId(nextTab.id);
    jumpTo(basePath);
  }, [activeTab, currentPath, drives, jumpTo, places, setActiveTabId, setTabs]);

  const openInNewTab = useCallback(
    (path: string) => {
      const target = path.trim();
      if (!target) return;
      pendingJumpSourceRef.current = "navigate";
      const nextTab = createTab(target, activeTab ?? defaultTabState, defaultTabState);
      pendingTabPathRef.current = normalizePath(target) ?? target;
      setTabs((prev) => [...prev, nextTab]);
      setActiveTabId(nextTab.id);
      jumpTo(target);
    },
    [activeTab, jumpTo, setActiveTabId, setTabs],
  );

  const selectTab = useCallback(
    (id: string) => {
      const selected = tabs.find((tab) => tab.id === id);
      if (!selected) return;
      pendingJumpSourceRef.current = "switch";
      pendingTabPathRef.current = normalizePath(selected.path) ?? selected.path;
      setActiveTabId(id);
      if (!shouldLoadPath(selected.path)) {
        pendingJumpSourceRef.current = null;
        return;
      }
      jumpTo(selected.path);
    },
    [jumpTo, setActiveTabId, shouldLoadPath, tabs],
  );

  const closeTab = useCallback(
    (id: string) => {
      if (tabs.length <= 1) return;
      const index = tabs.findIndex((tab) => tab.id === id);
      const nextTabs = tabs.filter((tab) => tab.id !== id);
      setTabs(nextTabs);

      if (id === activeTabId) {
        const fallback = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
        if (fallback) {
          pendingJumpSourceRef.current = "switch";
          pendingTabPathRef.current = normalizePath(fallback.path) ?? fallback.path;
          setActiveTabId(fallback.id);
          if (shouldLoadPath(fallback.path)) {
            jumpTo(fallback.path);
          } else {
            pendingJumpSourceRef.current = null;
          }
        }
      }
    },
    [activeTabId, jumpTo, setActiveTabId, setTabs, shouldLoadPath, tabs],
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
    sidebarOpen,
    sortState,
    jumpTo,
    browseTo,
    setViewMode,
    setSort,
    toggleSidebar,
    newTab,
    openInNewTab,
    selectTab,
    closeTab,
    reorderTabs,
  };
};
