// App shell wiring: composes state hooks, layout blocks, and overlays.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  clearThumbCache,
  copyPathsToClipboard,
  getThumbCacheDir,
  openPath,
  openShell,
} from "@/api";
import {
  AppContent,
  AppOverlays,
  AppStatusbar,
  AppTopstack,
  DrivePicker,
  PathBarActions,
  SidebarIcon,
  ToolbarIconButton,
} from "@/components";
import {
  useAppAppearance,
  useAppMenuState,
  useAppViewState,
  useCloseConfirm,
  useClipboardSync,
  useCssVarHeight,
  useDragOutHandler,
  useDirWatch,
  useDriveInfo,
  useEntryMenuItems,
  useFileDrop,
  useFileManager,
  useFileViewInteractions,
  useFileViewModel,
  useFilteredEntries,
  useKeybinds,
  useLayoutMenuItems,
  useMetaPrefetch,
  useScrollRequest,
  useSearchHotkey,
  useSelectionShortcuts,
  useShellAvailability,
  useSettings,
  useStatusLabels,
  useTabSession,
  useThumbnails,
  useTransferProgress,
  useWindowSize,
} from "@/hooks";
import {
  isEditableElement,
  makeDebug,
  normalizePath,
  splitNameExtension,
  tabLabel,
} from "@/lib";
import type { DropTarget } from "@/lib";
import { useClipboardStore, usePromptStore, useTooltipStore } from "@/modules";
import type {
  EntryContextTarget,
  FileEntry,
  RenameCommitReason,
  ShellKind,
  SortState,
} from "@/types";
import "@/styles/app.scss";
import appPackage from "../package.json";

const viewLog = makeDebug("view");
const APP_NAME = "Stratum";
const APP_VERSION = appPackage.version;
const APP_DESCRIPTION = "A modern, but simple file manager with some added flair.";
const isTauriEnv = () => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

const getSelectionTargets = (selected: Set<string>, parentPath: string | null) => {
  return Array.from(selected).filter((path) => path !== parentPath);
};

const formatDeleteLabel = (targets: string[]) => {
  const count = targets.length;
  if (count === 1) return tabLabel(targets[0] ?? "");
  return `${count} items`;
};

type RenamePlanItem = {
  path: string;
  nextName: string;
};


const orderSelectionByView = (
  targets: string[],
  indexMap: Map<string, number>,
) => {
  const ordered = [...targets];
  ordered.sort((left, right) => {
    const leftIndex = indexMap.get(left) ?? Number.POSITIVE_INFINITY;
    const rightIndex = indexMap.get(right) ?? Number.POSITIVE_INFINITY;
    return leftIndex - rightIndex;
  });
  return ordered;
};

const buildBulkRenamePlan = (
  baseName: string,
  targets: string[],
  entryByPath: Map<string, FileEntry>,
  entries: FileEntry[],
  indexMap: Map<string, number>,
) => {
  const ordered = orderSelectionByView(targets, indexMap);
  const targetSet = new Set(ordered);
  // Reserve names that already exist in the directory but are not part of the rename set.
  const reserved = new Set<string>();
  entries.forEach((entry) => {
    if (targetSet.has(entry.path)) return;
    reserved.add(entry.name.trim().toLowerCase());
  });

  const plan: RenamePlanItem[] = [];
  ordered.forEach((path, index) => {
    const entry = entryByPath.get(path);
    if (!entry) return;
    const dotExtension = entry.isDir
      ? ""
      : splitNameExtension(entry.name).dotExtension ?? "";
    // Match Explorer-style numbering: first keeps base, then (1), (2), etc.
    let suffixIndex = index === 0 ? 0 : index;
    let candidate = "";
    while (true) {
      const suffix = suffixIndex > 0 ? ` (${suffixIndex})` : "";
      candidate = `${baseName}${suffix}${dotExtension}`;
      const key = candidate.trim().toLowerCase();
      if (!key) {
        suffixIndex += 1;
        continue;
      }
      if (!reserved.has(key)) {
        reserved.add(key);
        break;
      }
      suffixIndex += 1;
    }

    if (candidate !== entry.name) {
      plan.push({ path: entry.path, nextName: candidate });
    } else {
      reserved.add(candidate.trim().toLowerCase());
    }
  });

  return { ordered, plan };
};

const getRenameInputValue = (
  target: { name: string; isDir: boolean },
  hideExtension: boolean,
) => {
  if (!hideExtension || target.isDir) return target.name;
  return splitNameExtension(target.name).base;
};

const applyHiddenExtension = (
  nextName: string,
  originalName: string,
  hideExtension: boolean,
  isDir: boolean,
) => {
  if (!hideExtension || isDir) return nextName;
  const { dotExtension } = splitNameExtension(originalName);
  if (!dotExtension) return nextName;
  const trimmed = nextName.trim();
  if (trimmed.toLowerCase().endsWith(dotExtension.toLowerCase())) {
    return trimmed;
  }
  return `${trimmed}${dotExtension}`;
};

const App = () => {
  // Core state and layout refs.
  const fileManager = useFileManager();
  const settings = useSettings();
  const tabSession = useTabSession({
    currentPath: fileManager.currentPath,
    loadDir: fileManager.loadDir,
    clearDir: fileManager.clearDir,
    defaultViewMode: settings.defaultViewMode,
    recentJumpsLimit: settings.sidebarRecentLimit,
  });
  const { dropTargetPath, dropTargetTabId, performDrop, setDropTarget } = useFileDrop({
    currentPath: fileManager.currentPath,
    onRefresh: fileManager.refresh,
  });
  const { scrollRequest, requestScrollToIndex } = useScrollRequest();
  const topstackRef = useRef<HTMLDivElement | null>(null);
  const statusbarRef = useRef<HTMLDivElement | null>(null);
  // Track tab switches so we can clear the view when landing on an untitled tab.
  const lastActiveTabIdRef = useRef<string | null>(null);
  // Track the last rendered tab/path to reset scroll on in-tab navigation.
  const lastViewRef = useRef<{ tabId: string | null; pathKey: string } | null>(null);
  const {
    contextMenu,
    settingsOpen,
    openSortMenu,
    openEntryMenu,
    closeContextMenu,
    toggleSettings,
    closeSettings,
  } = useAppMenuState();
  const promptOpen = usePromptStore((state) => Boolean(state.prompt));
  const [renameTarget, setRenameTarget] = useState<EntryContextTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [suppressInternalPresence, setSuppressInternalPresence] = useState(false);
  const [suppressExternalPresence, setSuppressExternalPresence] = useState(false);
  const suppressPresence = suppressInternalPresence || suppressExternalPresence;
  const renameCommitRef = useRef(false);
  const [thumbResetNonce, setThumbResetNonce] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { currentPath, parentPath, entries, entryMeta, totalCount, loading, status } =
    fileManager;
  const {
    activeTabId,
    activeTab,
    viewMode,
    sortState,
    tabs,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  } = tabSession;
  const viewPath = activeTab?.path ?? currentPath;
  const viewPathKey = normalizePath(viewPath ?? "");
  const currentPathKey = normalizePath(currentPath);
  // When a tab switch happens before the new directory load finishes,
  // avoid rendering stale entries from the previous path.
  const viewPending = Boolean(viewPathKey) && viewPathKey !== currentPathKey;
  const viewLoading = loading || viewPending;
  const viewEntries = viewPending ? [] : entries;
  const viewTotalCount = viewPending ? 0 : totalCount;
  const viewParentPathBase = viewPending ? null : parentPath;
  // Sidebar visibility is global (not per-tab) so it feels consistent across navigation.
  const sidebarOpen = settings.sidebarOpen;
  // Path, search, and view state for the main content area.
  const {
    pathValue,
    setPathValue,
    searchValue,
    setSearchValue,
    deferredSearchValue,
    searchInputRef,
    mainRef,
    browseFromView,
    handleGo,
    handleUp,
    clearSearchAndFocusView,
  } = useAppViewState({
    currentPath,
    displayPath: viewPath,
    parentPath: viewPending ? null : parentPath,
    loading,
    jumpTo: tabSession.jumpTo,
    browseTo: tabSession.browseTo,
  });

  const activeSearch = activeTab?.search ?? "";
  const searchSyncRef = useRef(false);
  const lastSearchTabIdRef = useRef<string | null>(null);

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
    tabSession.setSearch(searchValue);
  }, [activeSearch, activeTabId, searchValue, tabSession]);

  useSearchHotkey(searchInputRef, clearSearchAndFocusView);
  useCssVarHeight(topstackRef, "--topstack-height");
  useCssVarHeight(statusbarRef, "--statusbar-height");
  const { flushPersist: flushWindowSize } = useWindowSize();
  useCloseConfirm({
    enabled: isTauriEnv(),
    confirmClose: settings.confirmClose,
    onBeforeClose: flushWindowSize,
  });
  // Check available shells once so future actions can choose a supported target.
  const shellAvailability = useShellAvailability({ enabled: isTauriEnv() });
  useTransferProgress({ enabled: isTauriEnv() });
  // Watch the active directory for changes and refresh quietly when needed.
  useDirWatch({
    enabled: isTauriEnv(),
    activeTabId,
    activeTabPath: activeTab?.path ?? "",
    currentPath,
    tabs,
    sortState,
    searchQuery: activeSearch,
    loadDir: fileManager.loadDir,
    loading,
    onPresenceToggle: setSuppressExternalPresence,
  });

  // Global appearance settings reflected in CSS variables.
  useAppAppearance({
    accentTheme: settings.accentTheme,
    ambientBackground: settings.ambientBackground,
    blurOverlays: settings.blurOverlays,
    gridRounded: settings.gridRounded,
    gridCentered: settings.gridCentered,
    compactMode: settings.compactMode,
  });

  useEffect(() => {
    useTooltipStore.getState().hideTooltip();
  }, [activeTabId, currentPath, sidebarOpen, viewMode]);

  useEffect(() => {
    // Clear rename state on navigation or view switches.
    setRenameTarget(null);
    setRenameValue("");
  }, [activeTabId, currentPath, viewMode]);

  useEffect(() => {
    if (activeTabId === lastActiveTabIdRef.current) return;
    lastActiveTabIdRef.current = activeTabId;
    const tabPath = activeTab?.path ?? "";
    if (!tabPath.trim() && currentPath.trim()) {
      // Ensure untitled tabs show the lander instead of the previous tab contents.
      fileManager.clearDir({ silent: true });
    }
  }, [activeTab?.path, activeTabId, currentPath, fileManager]);

  useEffect(() => {
    viewLog(
      "view change: tab=%s path=%s mode=%s loading=%s",
      activeTabId ?? "none",
      currentPath,
      viewMode,
      loading ? "yes" : "no",
    );
  }, [activeTabId, currentPath, loading, viewMode]);

  useEffect(() => {
    if (!currentPath || loading) return;
    const activePath = activeTab?.path ?? currentPath;
    const currentKey = normalizePath(currentPath);
    const activeKey = normalizePath(activePath);
    // Only refresh when the active tab path matches the current view.
    if (activeKey !== currentKey) return;
    // Wait until the deferred query matches the active tab search.
    if (deferredSearchValue !== activeSearch) return;
    void fileManager.loadDir(currentPath, {
      sort: sortState,
      search: deferredSearchValue,
      silent: true,
    });
  }, [
    activeTab?.path,
    activeSearch,
    currentPath,
    deferredSearchValue,
    fileManager.loadDir,
    loading,
    sortState,
  ]);

  // Drive + place selection share the same jump target semantics.
  const handleSelectDrive = useCallback(
    (path: string) => tabSession.jumpTo(path),
    [tabSession.jumpTo],
  );
  const handleSelectPlace = useCallback(
    (path: string) => tabSession.jumpTo(path),
    [tabSession.jumpTo],
  );
  const stashActiveScroll = useCallback(() => {
    if (!activeTabId) return;
    const main = mainRef.current;
    if (!main) return;
    const listBody = main.querySelector<HTMLElement>(".list-body");
    if (listBody) {
      tabSession.setTabScrollTop(activeTabId, listBody.scrollTop);
      return;
    }
    const thumbViewport = main.querySelector<HTMLElement>(".thumb-viewport");
    if (thumbViewport) {
      tabSession.setTabScrollTop(activeTabId, thumbViewport.scrollTop);
    }
  }, [activeTabId, mainRef, tabSession]);
  const handleSelectTab = useCallback(
    (id: string) => {
      if (id === activeTabId) return;
      // Capture the outgoing tab scroll before switching to the next tab.
      stashActiveScroll();
      tabSession.selectTab(id);
    },
    [activeTabId, stashActiveScroll, tabSession],
  );
  const handleCloseTab = useCallback(
    (id: string) => {
      if (id === activeTabId) {
        stashActiveScroll();
      }
      tabSession.closeTab(id);
    },
    [activeTabId, stashActiveScroll, tabSession],
  );
  const handleNewTab = useCallback(() => {
    stashActiveScroll();
    tabSession.newTab();
  }, [stashActiveScroll, tabSession]);
  const handleOpenInNewTab = useCallback(
    (path: string) => {
      stashActiveScroll();
      tabSession.openInNewTab(path);
    },
    [stashActiveScroll, tabSession],
  );
  // Persist the current tab scroll before the app unloads.
  useEffect(() => {
    const handleBeforeUnload = () => {
      stashActiveScroll();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [stashActiveScroll]);
  const handleToggleSidebar = useCallback(() => {
    settings.updateSettings({ sidebarOpen: !settings.sidebarOpen });
  }, [settings]);
  const handleOpenAbout = useCallback(() => {
    setAboutOpen(true);
  }, []);
  const handleCloseAbout = useCallback(() => {
    setAboutOpen(false);
  }, []);

  const handleRefresh = useCallback(() => {
    void fileManager.refresh();
  }, [fileManager.refresh]);

  const handleBack = useCallback(() => {
    if (loading) return;
    goBack();
  }, [goBack, loading]);

  const handleForward = useCallback(() => {
    if (loading) return;
    goForward();
  }, [goForward, loading]);

  const handleSortChange = useCallback(
    (next: SortState) => {
      tabSession.setSort(next);
      if (!currentPath || loading) return;
      const activePath = activeTab?.path ?? currentPath;
      const currentKey = normalizePath(currentPath);
      const activeKey = normalizePath(activePath);
      if (!currentKey || currentKey !== activeKey) return;
      void fileManager.loadDir(currentPath, {
        sort: next,
        search: activeSearch,
        silent: true,
      });
    },
    [
      activeSearch,
      activeTab?.path,
      currentPath,
      fileManager.loadDir,
      loading,
      tabSession,
    ],
  );

  // Thumbnail pipeline input config.
  const thumbnailOptions = useMemo(
    () => ({
      size: settings.thumbnailSize,
      quality: settings.thumbnailQuality,
      format: settings.thumbnailFormat,
      allowVideos: settings.thumbnailVideos,
      cacheMb: settings.thumbnailCacheMb,
    }),
    [
      settings.thumbnailCacheMb,
      settings.thumbnailFormat,
      settings.thumbnailQuality,
      settings.thumbnailSize,
      settings.thumbnailVideos,
    ],
  );
  // Only reset the thumbnail cache when explicitly requested.
  const thumbnailResetKey = `reset:${thumbResetNonce}`;
  const { thumbnails, requestThumbnails } = useThumbnails(
    thumbnailOptions,
    settings.thumbnailsEnabled,
    thumbnailResetKey,
  );
  const blockReveal = viewLoading;

  const { sortedEntries, visibleCount, isFiltered, totalCount: resolvedTotalCount } =
    useFilteredEntries({
      entries: viewEntries,
      searchValue: deferredSearchValue,
      totalCount: viewTotalCount,
    });
  const metaPrefetchKey = `${currentPath}:${sortState.key}:${sortState.dir}:${deferredSearchValue}`;
  const shouldPrefetchMeta = sortState.key !== "name";
  useMetaPrefetch({
    enabled: shouldPrefetchMeta,
    loading,
    resetKey: metaPrefetchKey,
    entries: sortedEntries,
    entryMeta,
    requestMeta: fileManager.requestEntryMeta,
    // Defer non-visible updates to keep scrolling smooth; flush when done.
    deferUpdates: true,
    flushMeta: fileManager.flushEntryMeta,
  });

  // Drive stats for the statusbar and overlays.
  const { currentDriveInfo } = useDriveInfo({
    currentPath,
    drives: fileManager.drives,
    driveInfo: fileManager.driveInfo,
  });

  const canGoUp = Boolean(parentPath && parentPath !== currentPath);
  const showLander = !viewPath.trim() && !viewLoading;
  const showEmptyFolder =
    !showLander &&
    !viewLoading &&
    viewEntries.length === 0 &&
    deferredSearchValue.trim().length === 0;
  const viewParentPath =
    viewParentPathBase &&
    canGoUp &&
    settings.showParentEntry &&
    !isFiltered &&
    !showEmptyFolder
      ? viewParentPathBase
      : null;
  // Keep a per-tab trail so breadcrumb crumbs can show the deepest path visited.
  const crumbTrailPath = activeTab?.crumbTrailPath ?? viewPath;
  const viewKey = `${activeTabId ?? "none"}:${viewPathKey}`;
  const lastView = lastViewRef.current;
  const shouldResetScroll =
    lastView?.tabId === activeTabId && lastView?.pathKey !== viewPathKey;
  const scrollRestoreKey = viewKey;
  const scrollRestoreTop = shouldResetScroll
    ? 0
    : activeTabId
      ? activeTab?.scrollTop ?? 0
      : 0;

  useEffect(() => {
    if (!shouldResetScroll || !activeTabId) return;
    // Reset the stored scroll position when a tab navigates to a new path.
    tabSession.setTabScrollTop(activeTabId, 0);
  }, [activeTabId, shouldResetScroll, tabSession]);
  const contextMenuActive = Boolean(contextMenu);
  // Keep clipboard state synced with OS file copy/cut payloads.
  const { refreshFromOs: refreshClipboardFromOs } = useClipboardSync({
    enabled: isTauriEnv(),
    contextMenuOpen: contextMenuActive,
  });
  const viewModel = useFileViewModel(sortedEntries, viewParentPath);
  const requestScrollToIndexForView = useCallback(
    (index: number) => requestScrollToIndex(index, viewKey),
    [requestScrollToIndex, viewKey],
  );

  useEffect(() => {
    // Remember the last tab/path so we can detect in-tab navigation.
    lastViewRef.current = { tabId: activeTabId, pathKey: viewPathKey };
  }, [activeTabId, viewPathKey]);

  useEffect(() => {
    const trimmed = viewPath?.trim() ?? "";
    if (!isTauriEnv()) return;
    const appWindow = getCurrentWindow();
    const isUntitled = trimmed.toLowerCase() === "untitled";
    const title = trimmed && !isUntitled
      ? `${trimmed} - ${APP_NAME} ${APP_VERSION}`
      : `${APP_NAME} ${APP_VERSION}`;
    void appWindow.setTitle(title);
  }, [viewPath]);
  const {
    gridColumnsRef,
    handleGridColumnsChange,
    selected,
    selectItem,
    clearSelection,
    setSelection,
    selectionItems,
    getSelectionIndex,
    getSelectionTarget,
    handleSelectItem,
  } = useFileViewInteractions({
    viewModel,
    activeTabId,
    currentPath: viewPath,
    deferredSearchValue,
    viewMode,
    blockReveal,
    loading: viewLoading,
    settingsOpen,
    contextMenuOpen: contextMenuActive,
    mainRef,
    requestScrollToIndex: requestScrollToIndexForView,
  });

  const handleRenameCancel = useCallback(() => {
    setRenameTarget(null);
    setRenameValue("");
  }, []);

  const handleRenameCommit = useCallback((reason: RenameCommitReason = "enter") => {
    if (!renameTarget) return;
    if (renameCommitRef.current) return;
    const nextName = renameValue.trim();
    const originalName = renameTarget.name.trim();
    const selectionTargets = getSelectionTargets(selected, viewParentPath);
    const isMultiRename =
      selectionTargets.length > 1 && selectionTargets.includes(renameTarget.path);
    setRenameTarget(null);
    setRenameValue("");
    const hideExtension = settings.gridNameHideExtension && !renameTarget.isDir;
    const resolvedNextName = applyHiddenExtension(
      nextName,
      renameTarget.name,
      hideExtension,
      renameTarget.isDir,
    );
    if (!resolvedNextName || (!isMultiRename && resolvedNextName === originalName)) {
      renameCommitRef.current = false;
      return;
    }
    const shouldSelect = reason === "enter";
    if (!isMultiRename) {
      renameCommitRef.current = true;
      setSuppressInternalPresence(true);
      void fileManager
        .renameEntry(renameTarget.path, resolvedNextName)
        .then((nextPath) => {
          if (!nextPath) return;
          if (!shouldSelect) return;
          setSelection([nextPath], nextPath);
        })
        .finally(() => {
          renameCommitRef.current = false;
          setSuppressInternalPresence(false);
        });
      return;
    }

    // Explorer-style bulk rename uses the typed base name and preserves extensions.
    const baseName = renameTarget.isDir
      ? nextName
      : splitNameExtension(nextName).base.trim();
    if (!baseName) {
      renameCommitRef.current = false;
      return;
    }

    const { ordered, plan } = buildBulkRenamePlan(
      baseName,
      selectionTargets,
      viewModel.entryByPath,
      entries,
      viewModel.indexMap,
    );
    if (plan.length === 0) {
      renameCommitRef.current = false;
      return;
    }
    renameCommitRef.current = true;
    setSuppressInternalPresence(true);
    void fileManager
      .renameEntries(plan)
      .then((result) => {
        if (!result || !shouldSelect) return;
        const renamed = result.renamed;
        const nextSelection = ordered.map((path) => renamed.get(path) ?? path);
        const nextAnchor = renamed.get(renameTarget.path) ?? renameTarget.path;
        setSelection(nextSelection, nextAnchor);
      })
      .finally(() => {
        renameCommitRef.current = false;
        setSuppressInternalPresence(false);
      });
  }, [
    entries,
    fileManager,
    renameTarget,
    renameValue,
    settings.gridNameHideExtension,
    selected,
    setSelection,
    viewModel.entryByPath,
    viewModel.indexMap,
    viewParentPath,
  ]);

  // Cancel inline rename when the selection moves away from the rename target.
  const handleSelectionChange = useCallback(
    (paths: string[], anchor?: string) => {
      if (renameTarget && !paths.includes(renameTarget.path)) {
        handleRenameCommit("blur");
      }
      setSelection(paths, anchor);
    },
    [handleRenameCommit, renameTarget, setSelection],
  );

  const handleClearSelection = useCallback(() => {
    if (renameTarget) {
      handleRenameCommit("blur");
    }
    clearSelection();
  }, [clearSelection, handleRenameCommit, renameTarget]);

  const handleSelectItemWithRename = useCallback(
    (path: string, index: number, event: ReactMouseEvent) => {
      if (renameTarget && renameTarget.path !== path) {
        handleRenameCommit("blur");
      }
      handleSelectItem(path, index, event);
    },
    [handleRenameCommit, handleSelectItem, renameTarget],
  );

  const aboutMeta = useMemo(() => {
    const platform =
      typeof navigator !== "undefined"
        ? (navigator as Navigator & { userAgentData?: { platform?: string } })
            .userAgentData?.platform ??
          navigator.platform ??
          "Unknown"
        : "Unknown";
    return {
      runtime: isTauriEnv() ? "Tauri" : "Web",
      platform,
      buildMode: import.meta.env.MODE ?? "unknown",
    };
  }, []);

  const handleRenameStart = useCallback(
    (target: EntryContextTarget) => {
      if (!target?.path) return;
      if (!selected.has(target.path)) {
        handleSelectionChange([target.path], target.path);
      }
      setRenameTarget(target);
      setRenameValue(getRenameInputValue(target, settings.gridNameHideExtension));
    },
    [handleSelectionChange, selected, settings.gridNameHideExtension],
  );
  const selectionTargets = useMemo(
    () => getSelectionTargets(selected, viewParentPath),
    [selected, viewParentPath],
  );
  const handleStartDragOut = useDragOutHandler({
    viewParentPath,
    onRefresh: fileManager.refresh,
  });
  const handleInternalDrop = useCallback(
    (paths: string[], target: DropTarget | null) => {
      if (!target) return;
      void performDrop(paths, target.path);
    },
    [performDrop],
  );
  const handleInternalHover = useCallback(
    (target: DropTarget | null) => {
      setDropTarget(target);
    },
    [setDropTarget],
  );
  // Close on right-button press; open on release to avoid flicker.
  const handleLayoutContextMenuDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 2) return;
      event.preventDefault();
      flushSync(() => closeContextMenu());
    },
    [closeContextMenu],
  );
  const handleLayoutContextMenu = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 2) return;
      if (event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (isEditableElement(target)) return;
      openSortMenu(event);
    },
    [openSortMenu],
  );
  const handleEntryContextMenuDown = useCallback(
    (event: ReactPointerEvent, target: EntryContextTarget) => {
      if (event.button !== 2) return;
      if (!target?.path) return;
      event.preventDefault();
      event.stopPropagation();
      flushSync(() => closeContextMenu());
    },
    [closeContextMenu],
  );
  const handleEntryContextMenu = useCallback(
    (event: ReactPointerEvent, target: EntryContextTarget) => {
      if (event.button !== 2) return;
      if (!selected.has(target.path)) {
        handleSelectionChange([target.path], target.path);
      }
      openEntryMenu(event, target);
    },
    [handleSelectionChange, openEntryMenu, selected],
  );

  useSelectionShortcuts({
    blockReveal,
    contextMenuOpen: contextMenuActive,
    loading: viewLoading,
    settingsOpen,
    viewMode,
    mainRef,
    gridColumnsRef,
    selectionItems,
    getSelectionIndex,
    selectItem,
    requestScrollToIndex: requestScrollToIndexForView,
    getSelectionTarget,
    onOpenDir: browseFromView,
    onOpenEntry: fileManager.openEntry,
  });

  // Keybind gating helpers: protect interactions during modal states.
  const canHandleGlobalKeybind = useCallback(() => {
    return !settingsOpen && !contextMenu && !promptOpen;
  }, [contextMenu, promptOpen, settingsOpen]);

  const canHandleViewKeybind = useCallback(() => {
    if (!canHandleGlobalKeybind()) return false;
    if (blockReveal) return false;
    const active = document.activeElement;
    if (isEditableElement(active)) return false;
    return true;
  }, [blockReveal, canHandleGlobalKeybind]);

  // Keybind handlers are kept explicit for readability and testing.
  const handleNewTabKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleGlobalKeybind()) return false;
    handleNewTab();
    return true;
  }, [canHandleGlobalKeybind, handleNewTab]);

  const handleCloseTabKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleGlobalKeybind()) return false;
    if (!activeTabId) return false;
    handleCloseTab(activeTabId);
    return true;
  }, [activeTabId, canHandleGlobalKeybind, handleCloseTab]);

  const handleAdjacentTab = useCallback(
    (_event: KeyboardEvent, direction: -1 | 1) => {
      if (!canHandleGlobalKeybind()) return false;
      if (!activeTabId || tabSession.tabs.length < 2) return false;
      const index = tabSession.tabs.findIndex((tab) => tab.id === activeTabId);
      if (index < 0) return false;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= tabSession.tabs.length) return false;
      const target = tabSession.tabs[nextIndex];
      if (!target) return false;
      handleSelectTab(target.id);
      return true;
    },
    [activeTabId, canHandleGlobalKeybind, handleSelectTab, tabSession.tabs],
  );

  const handleSelectTabIndex = useCallback(
    (index: number) => {
      if (!canHandleGlobalKeybind()) return false;
      const target = tabs[index - 1];
      if (!target) return false;
      handleSelectTab(target.id);
      return true;
    },
    [canHandleGlobalKeybind, handleSelectTab, tabs],
  );

  const handleUndoKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (!fileManager.canUndo()) return false;
    void fileManager.undo();
    return true;
  }, [canHandleViewKeybind, fileManager]);

  const handleDeleteSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (selectionTargets.length === 0) return false;
    const runDelete = () => {
      void fileManager.deleteEntries(selectionTargets).then((report) => {
        if (report?.deleted) {
          handleClearSelection();
        }
      });
    };
    if (!settings.confirmDelete) {
      runDelete();
      return true;
    }
    const label = formatDeleteLabel(selectionTargets);
    usePromptStore.getState().showPrompt({
      title: selectionTargets.length === 1 ? "Delete item?" : "Delete items?",
      content: `Delete ${label}? You can undo with Ctrl+Z.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      onConfirm: runDelete,
    });
    return true;
  }, [
    canHandleViewKeybind,
    handleClearSelection,
    fileManager,
    settings.confirmDelete,
    selectionTargets,
  ]);

  const handleClearSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (selected.size === 0) return false;
    handleClearSelection();
    return true;
  }, [canHandleViewKeybind, handleClearSelection, selected.size]);

  const handleDuplicateSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (selectionTargets.length === 0) return false;
    void fileManager.duplicateEntries(selectionTargets);
    return true;
  }, [canHandleViewKeybind, fileManager, selectionTargets]);

  const handleCopySelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (selectionTargets.length === 0) return false;
    useClipboardStore.getState().setClipboard(selectionTargets);
    void copyPathsToClipboard(selectionTargets);
    return true;
  }, [canHandleViewKeybind, selectionTargets]);

  const handlePasteSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    const clipboard = useClipboardStore.getState().clipboard;
    if (clipboard && clipboard.paths.length > 0) {
      void fileManager.pasteEntries(clipboard.paths);
      return true;
    }
    void refreshClipboardFromOs().then((paths) => {
      if (!paths || paths.length === 0) return;
      void fileManager.pasteEntries(paths);
    });
    return true;
  }, [canHandleViewKeybind, fileManager, refreshClipboardFromOs]);

  const handleRefreshKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleGlobalKeybind()) return false;
    handleRefresh();
    return true;
  }, [canHandleGlobalKeybind, handleRefresh]);

  const keybindHandlers = useMemo(
    () => ({
      undo: handleUndoKeybind,
      newTab: handleNewTabKeybind,
      closeTab: handleCloseTabKeybind,
      deleteSelection: handleDeleteSelectionKeybind,
      duplicateSelection: handleDuplicateSelectionKeybind,
      prevTab: (event: KeyboardEvent) => handleAdjacentTab(event, -1),
      nextTab: (event: KeyboardEvent) => handleAdjacentTab(event, 1),
    }),
    [
      handleAdjacentTab,
      handleCloseTabKeybind,
      handleDeleteSelectionKeybind,
      handleDuplicateSelectionKeybind,
      handleNewTabKeybind,
      handleUndoKeybind,
    ],
  );

  const reservedKeybinds = useMemo(
    () => {
      const map: Record<string, (event: KeyboardEvent) => boolean> = {
        Escape: handleClearSelectionKeybind,
        F5: handleRefreshKeybind,
        "Control+c": handleCopySelectionKeybind,
        "Control+v": handlePasteSelectionKeybind,
        "Control+r": handleRefreshKeybind,
      };
      for (let index = 1; index <= 9; index += 1) {
        map[`Control+${index}`] = () => handleSelectTabIndex(index);
      }
      return map;
    },
    [
      handleCopySelectionKeybind,
      handlePasteSelectionKeybind,
      handleRefreshKeybind,
      handleSelectTabIndex,
    ],
  );

  useKeybinds({
    keybinds: settings.keybinds,
    handlers: keybindHandlers,
    reserved: reservedKeybinds,
  });

  // Status bar labels are kept in sync with selection and drive stats.
  const { countLabel, selectionLabel } = useStatusLabels({
    isFiltered,
    visibleCount,
    totalCount: resolvedTotalCount,
    currentDriveInfo,
    selected,
    entryMeta,
  });

  // Cache actions for the settings panel.
  const handleOpenThumbCache = useCallback(async () => {
    try {
      const cacheDir = await getThumbCacheDir();
      if (!cacheDir) return;
      await openPath(cacheDir);
    } catch {
      // Ignore cache open errors.
    }
  }, []);

  const handleClearThumbCache = useCallback(async () => {
    try {
      await clearThumbCache();
      setThumbResetNonce((prev) => prev + 1);
    } catch {
      // Ignore cache clear errors.
    }
  }, []);

  const handleOpenShell = useCallback((kind: ShellKind, path: string) => {
    const target = path.trim();
    if (!target) return;
    void openShell(kind, target).catch((error) => {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Unable to open the shell here.";
      usePromptStore.getState().showPrompt({
        title: "Couldn't open shell",
        content: message,
        confirmLabel: "OK",
        cancelLabel: null,
      });
    });
  }, []);
  // Context menu content is derived from the current target + sort state.
  const layoutMenuItems = useLayoutMenuItems({
    currentPath,
    sortState,
    onSortChange: handleSortChange,
    onPaste: (paths) => {
      void fileManager.pasteEntries(paths);
    },
    onCreateFolder: fileManager.createFolder,
    onCreateFile: fileManager.createFile,
    shellAvailability,
    menuOpenPwsh: settings.menuOpenPwsh,
    menuOpenWsl: settings.menuOpenWsl,
    onOpenShell: handleOpenShell,
  });
  const entryMenuItems = useEntryMenuItems({
    target: contextMenu?.kind === "entry" ? contextMenu.entry : null,
    selected,
    parentPath: viewParentPath,
    currentPath,
    onOpenEntry: fileManager.openEntry,
    onOpenDir: browseFromView,
    onDeleteEntries: fileManager.deleteEntries,
    confirmDelete: settings.confirmDelete,
    onClearSelection: handleClearSelection,
    onRenameEntry: handleRenameStart,
    onPasteEntries: (paths, destination) => {
      void fileManager.pasteEntries(paths, destination);
    },
    onCreateFolder: fileManager.createFolder,
    onCreateFile: fileManager.createFile,
    ffmpegAvailable: Boolean(shellAvailability?.ffmpeg),
  });
  const contextMenuItems =
    contextMenu?.kind === "entry" ? entryMenuItems : layoutMenuItems;
  const contextMenuOpen = Boolean(contextMenu && contextMenuItems.length > 0);

  // Layout class toggles full-width mode when the sidebar is closed.
  const layoutClass = `layout${sidebarOpen ? "" : " is-full"}`;

  return (
    <div className="app-shell">
      <AppTopstack
        topstackRef={topstackRef}
        pathBar={{
          onBack: handleBack,
          onForward: handleForward,
          onUp: handleUp,
          canGoBack,
          canGoForward,
          canGoUp,
          loading,
          leftSlot: (
            <>
              <button
                type="button"
                className="pathbar-brand about-trigger"
                aria-label={`About ${APP_NAME}`}
                aria-haspopup="dialog"
                onClick={handleOpenAbout}
              >
                <div className="brand-mark">
                  <img src="/favicon.png" alt="" aria-hidden="true" />
                </div>
              </button>
              <ToolbarIconButton
                label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                active={sidebarOpen}
                pressed={sidebarOpen}
                onClick={handleToggleSidebar}
              >
                <SidebarIcon />
              </ToolbarIconButton>
            </>
          ),
          driveSlot: (
            <DrivePicker
              activePath={viewPath ?? ""}
              drives={fileManager.drives}
              driveInfo={fileManager.driveInfo}
              onSelect={handleSelectDrive}
            />
          ),
          rightSlot: (
            <PathBarActions
              viewMode={viewMode}
              settingsOpen={settingsOpen}
              onViewChange={tabSession.setViewMode}
              onToggleSettings={toggleSettings}
            />
          ),
        }}
        pathInputsBar={{
          path: pathValue,
          search: searchValue,
          onPathChange: setPathValue,
          onSearchChange: setSearchValue,
          onSubmit: handleGo,
          onRefresh: handleRefresh,
          loading,
          searchInputRef,
        }}
        tabsBar={{
          tabs: tabSession.tabs,
          activeId: activeTabId,
          dropTargetId: dropTargetTabId,
          onSelect: handleSelectTab,
          onClose: handleCloseTab,
          onNew: handleNewTab,
          onReorder: tabSession.reorderTabs,
          showTabNumbers: settings.showTabNumbers,
          fixedWidthTabs: settings.fixedWidthTabs,
        }}
        crumbsBar={{
          path: viewPath,
          trailPath: crumbTrailPath,
          dropTargetPath,
          onNavigate: browseFromView,
          onNavigateNewTab: handleOpenInNewTab,
        }}
      />

      <AppContent
        layoutClass={layoutClass}
        sidebarOpen={sidebarOpen}
        sidebarProps={{
          places: fileManager.places,
          recentJumps: tabSession.recentJumps,
          activePath: currentPath,
          sectionOrder: settings.sidebarSectionOrder,
          hiddenSections: settings.sidebarHiddenSections,
          onSelect: handleSelectPlace,
          onSelectRecent: tabSession.jumpTo,
          onSelectNewTab: handleOpenInNewTab,
        }}
        mainRef={mainRef}
        onContextMenu={
          showLander || showEmptyFolder ? undefined : handleLayoutContextMenu
        }
        onContextMenuDown={
          showLander || showEmptyFolder ? undefined : handleLayoutContextMenuDown
        }
        fileViewProps={{
          currentPath: viewPath ?? "",
          viewMode,
            entries: sortedEntries,
            items: viewModel.items,
          loading: viewLoading,
          showLander,
          recentJumps: tabSession.recentJumps,
          onOpenRecent: browseFromView,
          drives: fileManager.drives,
          driveInfo: fileManager.driveInfo,
          onOpenDrive: handleSelectDrive,
          canGoUp,
          onGoUp: handleUp,
          searchQuery: deferredSearchValue,
          viewKey,
          scrollRestoreKey,
          scrollRestoreTop,
          scrollRequest,
          smoothScroll: settings.smoothScroll,
          compactMode: settings.compactMode,
          sortState,
          onSortChange: handleSortChange,
          selectedPaths: selected,
          onSetSelection: handleSelectionChange,
          onOpenDir: browseFromView,
          onOpenDirNewTab: handleOpenInNewTab,
          onOpenEntry: fileManager.openEntry,
          onCreateFolder: fileManager.createFolder,
          onCreateFile: fileManager.createFile,
          onSelectItem: handleSelectItemWithRename,
          onClearSelection: handleClearSelection,
          renameTargetPath: renameTarget?.path ?? null,
          renameValue,
          onRenameChange: setRenameValue,
          onRenameCommit: handleRenameCommit,
          onRenameCancel: handleRenameCancel,
          entryMeta,
          onRequestMeta: fileManager.requestEntryMeta,
          thumbnailsEnabled: settings.thumbnailsEnabled,
          thumbnails,
          onRequestThumbs: requestThumbnails,
          thumbnailFit: settings.thumbnailFit,
          thumbnailAppIcons: settings.thumbnailAppIcons,
          categoryTinting: settings.categoryTinting,
          gridSize: settings.gridSize,
          gridAutoColumns: settings.gridAutoColumns,
          gridShowSize: settings.gridShowSize,
          gridShowExtension: settings.gridShowExtension,
          gridNameEllipsis: settings.gridNameEllipsis,
          gridNameHideExtension: settings.gridNameHideExtension,
          thumbResetKey: thumbnailResetKey,
          presenceEnabled: !suppressPresence,
          onContextMenu:
            showLander || showEmptyFolder ? undefined : handleLayoutContextMenu,
          onContextMenuDown:
            showLander || showEmptyFolder ? undefined : handleLayoutContextMenuDown,
          onEntryContextMenu: handleEntryContextMenu,
          onEntryContextMenuDown: handleEntryContextMenuDown,
          onGridColumnsChange: handleGridColumnsChange,
          dropTargetPath,
          onStartDragOut: handleStartDragOut,
          onInternalDrop: handleInternalDrop,
          onInternalHover: handleInternalHover,
        }}
      />

      <AppStatusbar
        statusbarRef={statusbarRef}
        statusBar={{
          message: status.message,
          level: status.level,
          countLabel,
          selectionLabel,
        }}
      />
      <AppOverlays
        about={{
          open: aboutOpen,
          appName: APP_NAME,
          description: APP_DESCRIPTION,
          version: APP_VERSION,
          buildMode: aboutMeta.buildMode,
          runtime: aboutMeta.runtime,
          platform: aboutMeta.platform,
          onClose: handleCloseAbout,
        }}
        contextMenu={{
          open: contextMenuOpen,
          x: contextMenu?.x ?? 0,
          y: contextMenu?.y ?? 0,
          items: contextMenuItems,
          onClose: closeContextMenu,
        }}
        settings={{
          open: settingsOpen,
          onClose: closeSettings,
          onOpenCacheLocation: handleOpenThumbCache,
          onClearCache: handleClearThumbCache,
        }}
      />
    </div>
  );
};

export default App;
