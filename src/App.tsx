// App shell wiring: composes state hooks, layout blocks, and overlays.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { ViewMode } from "@/types";
import { clearThumbCache, copyPathsToClipboard, getThumbCacheDir, openPath } from "@/api";
import { AppContent, AppOverlays, AppStatusbar, AppTopstack } from "@/components";
import {
  useAppAppearance,
  useAppMenuState,
  useAppViewState,
  useCssVarHeight,
  useDragOutHandler,
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
  useScrollPositions,
  useScrollRequest,
  useSearchHotkey,
  useSelectionShortcuts,
  useSettings,
  useStatusLabels,
  useTabSession,
  useThumbnails,
  useWindowSize,
} from "@/hooks";
import { isEditableElement, makeDebug, normalizePath, tabLabel } from "@/lib";
import { useClipboardStore, usePromptStore, useTooltipStore } from "@/modules";
import "@/styles/app.scss";

const MAX_SCROLL_POSITIONS = 160;
const SCROLL_PERSIST_DELAY = 800;
const viewLog = makeDebug("view");
const scrollLog = makeDebug("scroll:key");
const scrollSaveLog = makeDebug("scroll:save");

const getSelectionTargets = (selected: Set<string>, parentPath: string | null) => {
  return Array.from(selected).filter((path) => path !== parentPath);
};

const formatDeleteLabel = (targets: string[]) => {
  const count = targets.length;
  if (count === 1) return tabLabel(targets[0] ?? "");
  return `${count} items`;
};

const buildScrollKey = (
  tabId: string | null,
  viewMode: ViewMode,
  path: string,
  searchValue: string,
) => {
  const normalizedPath = normalizePath(path ?? "");
  const normalizedSearch = searchValue.trim().toLowerCase();
  return `${tabId ?? "none"}:${viewMode}:${normalizedPath}:${normalizedSearch}`;
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
  const { dropTargetPath } = useFileDrop({
    currentPath: fileManager.currentPath,
    onRefresh: fileManager.refresh,
  });
  const { scrollRequest, requestScrollToIndex } = useScrollRequest();
  const topstackRef = useRef<HTMLDivElement | null>(null);
  const statusbarRef = useRef<HTMLDivElement | null>(null);
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
  const [thumbResetNonce, setThumbResetNonce] = useState(0);
  const { getScrollTop, setScrollTop } = useScrollPositions({
    maxEntries: MAX_SCROLL_POSITIONS,
    persistDelayMs: SCROLL_PERSIST_DELAY,
  });
  // Track the latest scroll position so tab switches can flush immediately.
  const lastScrollSnapshotRef = useRef<{ key: string; top: number } | null>(null);
  const handleScrollTopChange = useCallback(
    (key: string, scrollTop: number) => {
      lastScrollSnapshotRef.current = { key, top: scrollTop };
      setScrollTop(key, scrollTop);
    },
    [setScrollTop],
  );
  const flushActiveScroll = useCallback(() => {
    const snapshot = lastScrollSnapshotRef.current;
    if (!snapshot) return;
    if (scrollSaveLog.enabled) {
      scrollSaveLog("save key=%s top=%d", snapshot.key, Math.round(snapshot.top));
    }
    setScrollTop(snapshot.key, snapshot.top);
  }, [setScrollTop]);
  const { currentPath, parentPath, entries, entryMeta, totalCount, loading, status } =
    fileManager;
  const { activeTabId, activeTab, viewMode, sidebarOpen, sortState, tabs } = tabSession;
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
  } = useAppViewState({
    currentPath,
    parentPath,
    loading,
    loadDir: fileManager.loadDir,
    jumpTo: tabSession.jumpTo,
    browseTo: tabSession.browseTo,
  });

  useSearchHotkey(searchInputRef);
  useCssVarHeight(topstackRef, "--topstack-height");
  useCssVarHeight(statusbarRef, "--statusbar-height");
  useWindowSize();

  // Global appearance settings reflected in CSS variables.
  useAppAppearance({
    accentTheme: settings.accentTheme,
    ambientBackground: settings.ambientBackground,
    blurOverlays: settings.blurOverlays,
    gridRounded: settings.gridRounded,
    gridCentered: settings.gridCentered,
  });

  useEffect(() => {
    useTooltipStore.getState().hideTooltip();
  }, [activeTabId, currentPath, sidebarOpen, viewMode]);

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
    if (activeKey && currentKey && activeKey !== currentKey) return;
    void fileManager.loadDir(currentPath, {
      sort: sortState,
      search: deferredSearchValue,
      silent: true,
    });
  }, [
    activeTab?.path,
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
  const handleSelectTab = useCallback(
    (id: string) => {
      flushActiveScroll();
      tabSession.selectTab(id);
    },
    [flushActiveScroll, tabSession],
  );
  const handleCloseTab = useCallback(
    (id: string) => {
      flushActiveScroll();
      tabSession.closeTab(id);
    },
    [flushActiveScroll, tabSession],
  );
  const handleNewTab = useCallback(() => {
    flushActiveScroll();
    tabSession.newTab();
  }, [flushActiveScroll, tabSession]);
  const handleOpenInNewTab = useCallback(
    (path: string) => {
      flushActiveScroll();
      tabSession.openInNewTab(path);
    },
    [flushActiveScroll, tabSession],
  );

  const handleRefresh = useCallback(() => {
    void fileManager.refresh();
  }, [fileManager.refresh]);

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
  const thumbnailResetKey = `${currentPath}:${thumbResetNonce}`;
  const { thumbnails, requestThumbnails } = useThumbnails(
    thumbnailOptions,
    settings.thumbnailsEnabled,
    thumbnailResetKey,
  );
  const blockReveal = loading;

  const { sortedEntries, visibleCount, isFiltered, totalCount: resolvedTotalCount } =
    useFilteredEntries({
    entries,
    searchValue: deferredSearchValue,
    totalCount,
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
  const { driveInfoMap, currentDriveInfo } = useDriveInfo({
    currentPath,
    drives: fileManager.drives,
    driveInfo: fileManager.driveInfo,
  });

  const canGoUp = Boolean(parentPath && parentPath !== currentPath);
  const viewParentPath =
    canGoUp && settings.showParentEntry && !isFiltered ? parentPath : null;
  const showLander = !currentPath.trim() && !loading;
  const viewPath = activeTab?.path ?? currentPath;
  const scrollReady =
    Boolean(currentPath) &&
    !loading &&
    normalizePath(viewPath) === normalizePath(currentPath);
  const desiredScrollKey = buildScrollKey(
    activeTabId,
    viewMode,
    viewPath,
    deferredSearchValue,
  );
  const stableScrollKeyRef = useRef(desiredScrollKey);
  // Keep using the last scroll key tied to rendered content until the new view is ready.
  if (scrollReady) {
    stableScrollKeyRef.current = desiredScrollKey;
  }
  const scrollKey = scrollReady ? desiredScrollKey : stableScrollKeyRef.current;
  if (scrollLog.enabled) {
    scrollLog(
      "key: active=%s desired=%s using=%s ready=%s path=%s",
      activeTabId ?? "none",
      desiredScrollKey,
      scrollKey,
      scrollReady ? "yes" : "no",
      currentPath,
    );
  }
  const initialScrollTop = getScrollTop(scrollKey);
  const contextMenuActive = Boolean(contextMenu);
  const viewModel = useFileViewModel(sortedEntries, viewParentPath);
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
    currentPath,
    deferredSearchValue,
    viewMode,
    blockReveal,
    loading,
    settingsOpen,
    contextMenuOpen: contextMenuActive,
    mainRef,
    requestScrollToIndex,
  });
  const selectionTargets = useMemo(
    () => getSelectionTargets(selected, viewParentPath),
    [selected, viewParentPath],
  );
  const handleStartDragOut = useDragOutHandler({
    viewParentPath,
    onRefresh: fileManager.refresh,
  });
  const handleLayoutContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (isEditableElement(target)) return;
      openSortMenu(event);
    },
    [openSortMenu],
  );
  const handleEntryContextMenu = useCallback(
    (event: ReactMouseEvent, target: { path: string; isDir: boolean }) => {
      if (!selected.has(target.path)) {
        setSelection([target.path], target.path);
      }
      openEntryMenu(event, target);
    },
    [openEntryMenu, selected, setSelection],
  );

  useSelectionShortcuts({
    blockReveal,
    contextMenuOpen: contextMenuActive,
    loading,
    settingsOpen,
    viewMode,
    mainRef,
    gridColumnsRef,
    selectionItems,
    getSelectionIndex,
    selectItem,
    requestScrollToIndex,
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
    if (loading || blockReveal) return false;
    const active = document.activeElement;
    if (isEditableElement(active)) return false;
    return true;
  }, [blockReveal, canHandleGlobalKeybind, loading]);

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

  const handleDeleteSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (selectionTargets.length === 0) return false;
    const label = formatDeleteLabel(selectionTargets);
    usePromptStore.getState().showPrompt({
      title: selectionTargets.length === 1 ? "Delete item?" : "Delete items?",
      content: `Delete ${label}? This cannot be undone.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      onConfirm: () => {
        void fileManager.deleteEntries(selectionTargets).then((report) => {
          if (report?.deleted) {
            clearSelection();
          }
        });
      },
    });
    return true;
  }, [
    canHandleViewKeybind,
    clearSelection,
    fileManager,
    selectionTargets,
  ]);

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
    if (!clipboard || clipboard.paths.length === 0) return false;
    void fileManager.pasteEntries(clipboard.paths);
    return true;
  }, [canHandleViewKeybind, fileManager]);

  const handleRefreshKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleGlobalKeybind()) return false;
    handleRefresh();
    return true;
  }, [canHandleGlobalKeybind, handleRefresh]);

  const keybindHandlers = useMemo(
    () => ({
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
    ],
  );

  const reservedKeybinds = useMemo(
    () => {
      const map: Record<string, (event: KeyboardEvent) => boolean> = {
        F5: handleRefreshKeybind,
        "Control+c": handleCopySelectionKeybind,
        "Control+v": handlePasteSelectionKeybind,
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
  // Context menu content is derived from the current target + sort state.
  const layoutMenuItems = useLayoutMenuItems({
    sortState,
    onSortChange: tabSession.setSort,
    onPaste: (paths) => {
      void fileManager.pasteEntries(paths);
    },
  });
  const entryMenuItems = useEntryMenuItems({
    target: contextMenu?.kind === "entry" ? contextMenu.entry : null,
    selected,
    parentPath: viewParentPath,
    currentPath,
    onOpenEntry: fileManager.openEntry,
    onOpenDir: browseFromView,
    onDeleteEntries: fileManager.deleteEntries,
    onClearSelection: clearSelection,
    onPasteEntries: (paths, destination) => {
      void fileManager.pasteEntries(paths, destination);
    },
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
        driveBar={{
          drives: fileManager.drives,
          driveInfo: driveInfoMap,
          activePath: currentPath,
          viewMode,
          sidebarOpen,
          settingsOpen,
          onSelect: handleSelectDrive,
          onSelectNewTab: handleOpenInNewTab,
          onViewChange: tabSession.setViewMode,
          onToggleSidebar: tabSession.toggleSidebar,
          onToggleSettings: toggleSettings,
        }}
        pathBar={{
          path: pathValue,
          search: searchValue,
          onPathChange: setPathValue,
          onSearchChange: setSearchValue,
          onSubmit: handleGo,
          onUp: handleUp,
          onRefresh: handleRefresh,
          canGoUp,
          loading,
          searchInputRef,
        }}
        tabsBar={{
          tabs: tabSession.tabs,
          activeId: activeTabId,
          onSelect: handleSelectTab,
          onClose: handleCloseTab,
          onNew: handleNewTab,
          onReorder: tabSession.reorderTabs,
          showTabNumbers: settings.showTabNumbers,
          fixedWidthTabs: settings.fixedWidthTabs,
        }}
        crumbsBar={{ path: viewPath, onNavigate: browseFromView }}
      />

      <AppContent
        layoutClass={layoutClass}
        sidebarOpen={sidebarOpen}
        sidebarProps={{
          places: fileManager.places,
          recentJumps: tabSession.recentJumps,
          activePath: currentPath,
          sectionOrder: settings.sidebarSectionOrder,
          showTips: settings.sidebarShowTips,
          onSelect: handleSelectPlace,
          onSelectRecent: tabSession.jumpTo,
          onSelectNewTab: handleOpenInNewTab,
        }}
        mainRef={mainRef}
        onContextMenu={handleLayoutContextMenu}
        fileViewProps={{
          viewMode,
          entries: sortedEntries,
          items: viewModel.items,
          itemIndexMap: viewModel.indexMap,
          loading,
          showLander,
          searchQuery: deferredSearchValue,
          scrollKey,
          initialScrollTop,
          scrollReady,
          scrollRequest,
          smoothScroll: settings.smoothScroll,
          selectedPaths: selected,
          onSetSelection: setSelection,
          onOpenDir: browseFromView,
          onOpenDirNewTab: handleOpenInNewTab,
          onOpenEntry: fileManager.openEntry,
          onSelectItem: handleSelectItem,
          onClearSelection: clearSelection,
          onScrollTopChange: handleScrollTopChange,
          entryMeta,
          onRequestMeta: fileManager.requestEntryMeta,
          thumbnailsEnabled: settings.thumbnailsEnabled,
          thumbnails,
          onRequestThumbs: requestThumbnails,
          categoryTinting: settings.categoryTinting,
          gridSize: settings.gridSize,
          gridShowSize: settings.gridShowSize,
          gridShowExtension: settings.gridShowExtension,
          gridNameEllipsis: settings.gridNameEllipsis,
          gridNameHideExtension: settings.gridNameHideExtension,
          thumbResetKey: thumbnailResetKey,
          onContextMenu: openSortMenu,
          onEntryContextMenu: handleEntryContextMenu,
          onGridColumnsChange: handleGridColumnsChange,
          dropTargetPath,
          onStartDragOut: handleStartDragOut,
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
