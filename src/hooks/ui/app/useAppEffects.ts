// Centralizes app-wide side effects so App.tsx stays focused on data flow.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RefObject } from "react";
import type { EntryContextTarget, SortState, Tab, ViewMode } from "@/types";
import type { AccentTheme } from "@/modules";
import { useTooltipStore } from "@/modules";
import { normalizePath } from "@/lib";
import {
  useAppAppearance,
  useCloseConfirm,
  useDirWatch,
  useSearchHotkey,
  useTransferProgress,
} from "@/hooks";

type AppEffectRefs = {
  searchInputRef: RefObject<HTMLInputElement | null>;
  lastViewRef: RefObject<{ tabId: string | null; pathKey: string } | null>;
};

type AppEffectSettings = {
  confirmClose: boolean;
  accentTheme: AccentTheme;
  ambientBackground: boolean;
  blurOverlays: boolean;
  gridRounded: boolean;
  gridCentered: boolean;
};

type AppEffectView = {
  activeTabId: string | null;
  activeTabPath: string;
  activeSearch: string;
  searchValue: string;
  currentPath: string;
  viewPath: string;
  viewPathKey: string;
  viewMode: ViewMode;
  loading: boolean;
  sidebarOpen: boolean;
  deferredSearchValue: string;
  sortState: SortState;
  tabs: Tab[];
  contextMenuOpen: boolean;
};

type AppEffectActions = {
  clearSearchAndFocusView: () => void;
  closePreviewIfOpen: () => boolean;
  setSearchValue: (value: string) => void;
  setTabSearch: (value: string) => void;
  flushWindowSize: () => void;
  loadDir: (
    path: string,
    options?: { sort?: SortState; search?: string; silent?: boolean },
  ) => Promise<void>;
  requestEntryMeta: (
    paths: string[],
    options?: { force?: boolean; defer?: boolean },
  ) => Promise<unknown>;
  clearDir: (options?: { silent?: boolean }) => void;
  setRenameTarget: (value: EntryContextTarget | null) => void;
  setRenameValue: (value: string) => void;
  setTabScrollTop: (tabId: string, top: number) => void;
  stashActiveScroll: () => void;
  onPresenceToggle: (suppress: boolean) => void;
};

type UseAppEffectsOptions = {
  isTauriEnv: boolean;
  appName: string;
  appVersion: string;
  refs: AppEffectRefs;
  settings: AppEffectSettings;
  view: AppEffectView;
  actions: AppEffectActions;
  shouldResetScroll: boolean;
  viewLog: (...args: unknown[]) => void;
};

export const useAppEffects = ({
  isTauriEnv,
  appName,
  appVersion,
  refs,
  settings,
  view,
  actions,
  shouldResetScroll,
  viewLog,
}: UseAppEffectsOptions) => {
  const { searchInputRef, lastViewRef } = refs;
  const {
    confirmClose,
    accentTheme,
    ambientBackground,
    blurOverlays,
    gridRounded,
    gridCentered,
  } = settings;
  const {
    activeTabId,
    activeTabPath,
    activeSearch,
    searchValue,
    currentPath,
    viewPath,
    viewPathKey,
    viewMode,
    loading,
    sidebarOpen,
    deferredSearchValue,
    sortState,
    tabs,
    contextMenuOpen,
  } = view;
  const {
    clearSearchAndFocusView,
    closePreviewIfOpen,
    setSearchValue,
    setTabSearch,
    flushWindowSize,
    loadDir,
    requestEntryMeta,
    clearDir,
    setRenameTarget,
    setRenameValue,
    setTabScrollTop,
    stashActiveScroll,
    onPresenceToggle,
  } = actions;
  const searchSyncRef = useRef(false);
  const lastSearchTabIdRef = useRef<string | null>(null);
  const lastActiveTabIdRef = useRef<string | null>(null);
  const searchLoadTimerRef = useRef<number | null>(null);

  const clearSearchLoadTimer = () => {
    if (searchLoadTimerRef.current == null) return;
    window.clearTimeout(searchLoadTimerRef.current);
    searchLoadTimerRef.current = null;
  };

  useSearchHotkey(searchInputRef, clearSearchAndFocusView);
  useCloseConfirm({
    enabled: isTauriEnv,
    confirmClose,
    onBeforeClose: flushWindowSize,
    onBeforePrompt: closePreviewIfOpen,
  });
  useTransferProgress({ enabled: isTauriEnv });
  useDirWatch({
    enabled: isTauriEnv,
    activeTabId,
    activeTabPath,
    currentPath,
    tabs,
    sortState,
    searchQuery: activeSearch,
    loadDir,
    requestEntryMeta,
    loading,
    onPresenceToggle,
  });
  useAppAppearance({
    accentTheme,
    ambientBackground,
    blurOverlays,
    gridRounded,
    gridCentered,
  });

  useEffect(() => {
    if (activeTabId === lastSearchTabIdRef.current) return;
    lastSearchTabIdRef.current = activeTabId;
    // Keep the search input synced with the newly active tab's filter.
    searchSyncRef.current = true;
    setSearchValue(activeSearch);
  }, [activeSearch, activeTabId, setSearchValue]);

  useEffect(() => {
    if (!activeTabId) return;
    if (searchSyncRef.current) {
      searchSyncRef.current = false;
      return;
    }
    if (activeSearch === searchValue) return;
    setTabSearch(searchValue);
  }, [activeSearch, activeTabId, searchValue, setTabSearch]);

  useEffect(() => {
    useTooltipStore.getState().hideTooltip();
  }, [activeTabId, currentPath, sidebarOpen, viewMode]);

  useEffect(() => {
    if (!contextMenuOpen) return;
    const tooltip = useTooltipStore.getState();
    tooltip.hideTooltip();
    tooltip.blockTooltips();
  }, [contextMenuOpen]);

  useEffect(() => {
    // Clear rename state on navigation or view switches.
    setRenameTarget(null);
    setRenameValue("");
  }, [activeTabId, currentPath, setRenameTarget, setRenameValue, viewMode]);

  useEffect(() => {
    if (activeTabId === lastActiveTabIdRef.current) return;
    lastActiveTabIdRef.current = activeTabId;
    const tabPath = activeTabPath ?? "";
    if (!tabPath.trim() && currentPath.trim()) {
      // Ensure untitled tabs show the lander instead of the previous tab contents.
      clearDir({ silent: true });
    }
  }, [activeTabId, activeTabPath, clearDir, currentPath]);

  useEffect(() => {
    viewLog(
      "view change: tab=%s path=%s mode=%s loading=%s",
      activeTabId ?? "none",
      currentPath,
      viewMode,
      loading ? "yes" : "no",
    );
  }, [activeTabId, currentPath, loading, viewMode, viewLog]);

  useEffect(() => {
    if (!currentPath || loading) return;
    const activePath = activeTabPath ?? currentPath;
    if (!activePath) return;
    const currentKey = normalizePath(currentPath);
    const activeKey = normalizePath(activePath);
    // Only refresh when the active tab path matches the current view.
    if (!currentKey || currentKey !== activeKey) return;
    if (deferredSearchValue !== activeSearch) return;
    const runSearchLoad = () => {
      void loadDir(currentPath, {
        sort: sortState,
        search: deferredSearchValue,
        silent: true,
      });
    };

    // Slightly debounce active filtering to reduce list churn while typing.
    const hasFilter = deferredSearchValue.trim().length > 0;
    clearSearchLoadTimer();
    if (!hasFilter) {
      runSearchLoad();
      return;
    }

    searchLoadTimerRef.current = window.setTimeout(() => {
      searchLoadTimerRef.current = null;
      runSearchLoad();
    }, 110);

    return () => {
      clearSearchLoadTimer();
    };
  }, [
    activeSearch,
    activeTabPath,
    currentPath,
    deferredSearchValue,
    loadDir,
    loading,
    sortState,
  ]);

  useEffect(() => {
    return () => {
      clearSearchLoadTimer();
    };
  }, []);

  useEffect(() => {
    if (!shouldResetScroll || !activeTabId) return;
    // Reset the stored scroll position when a tab navigates to a new path.
    setTabScrollTop(activeTabId, 0);
  }, [activeTabId, setTabScrollTop, shouldResetScroll]);

  useEffect(() => {
    // Remember the last tab/path so we can detect in-tab navigation.
    lastViewRef.current = { tabId: activeTabId, pathKey: viewPathKey };
  }, [activeTabId, lastViewRef, viewPathKey]);

  useEffect(() => {
    if (!isTauriEnv) return;
    const trimmed = viewPath?.trim() ?? "";
    const appWindow = getCurrentWindow();
    const isUntitled = trimmed.toLowerCase() === "untitled";
    const title = trimmed && !isUntitled ? `${trimmed} - ${appName} ${appVersion}` : `${appName} ${appVersion}`;
    void appWindow.setTitle(title);
  }, [appName, appVersion, isTauriEnv, viewPath]);

  useEffect(() => {
    const root = document.documentElement;
    const syncWindowFocus = () => {
      root.dataset.windowFocus = document.hasFocus() ? "true" : "false";
    };

    syncWindowFocus();
    window.addEventListener("focus", syncWindowFocus);
    window.addEventListener("blur", syncWindowFocus);

    return () => {
      window.removeEventListener("focus", syncWindowFocus);
      window.removeEventListener("blur", syncWindowFocus);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!isTauriEnv) {
      delete root.dataset.windowsVersion;
      return;
    }

    let mounted = true;
    void invoke<boolean>("is_windows_11")
      .then((isWindows11) => {
        if (!mounted) return;
        if (isWindows11) {
          root.dataset.windowsVersion = "11";
        } else {
          delete root.dataset.windowsVersion;
        }
      })
      .catch(() => {
        if (!mounted) return;
        delete root.dataset.windowsVersion;
      });

    return () => {
      mounted = false;
    };
  }, [isTauriEnv]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      stashActiveScroll();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [stashActiveScroll]);
};
