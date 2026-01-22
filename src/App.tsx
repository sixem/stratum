// App shell wiring: composes state hooks, layout blocks, and overlays.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { clearThumbCache, getThumbCacheDir, openPath } from "@/api";
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
  useFilteredEntries,
  useKeybinds,
  useMetaPrefetch,
  useScrollPositions,
  useScrollRequest,
  useSearchHotkey,
  useSelectionShortcuts,
  useSettings,
  useSortMenuItems,
  useStatusLabels,
  useTabSession,
  useThumbnails,
  useWindowSize,
} from "@/hooks";
import { isEditableElement, tabLabel } from "@/lib";
import { useClipboardStore, usePromptStore, useTooltipStore } from "@/modules";
import "@/styles/app.scss";

const MAX_SCROLL_POSITIONS = 160;
const SCROLL_PERSIST_DELAY = 800;

const getSelectionTargets = (selected: Set<string>, parentPath: string | null) => {
  return Array.from(selected).filter((path) => path !== parentPath);
};

const formatDeleteLabel = (targets: string[]) => {
  const count = targets.length;
  if (count === 1) return tabLabel(targets[0] ?? "");
  return `${count} items`;
};

const App = () => {
  // Core state and layout refs.
  const fileManager = useFileManager();
  const settings = useSettings();
  const tabSession = useTabSession({
    currentPath: fileManager.currentPath,
    drives: fileManager.drives,
    places: fileManager.places,
    loadDir: fileManager.loadDir,
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
  const { currentPath, parentPath, entries, entryMeta, loading, status } = fileManager;
  const { activeTabId, activeTab, viewMode, sidebarOpen, sortState } = tabSession;
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

  // Drive + place selection share the same jump target semantics.
  const handleSelectDrive = useCallback(
    (path: string) => tabSession.jumpTo(path),
    [tabSession.jumpTo],
  );
  const handleSelectPlace = useCallback(
    (path: string) => tabSession.jumpTo(path),
    [tabSession.jumpTo],
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
  const needsMetaPrefetch = sortState.key !== "name";
  const metaReady = useMetaPrefetch({
    enabled: needsMetaPrefetch,
    loading,
    resetKey: `${currentPath}:${sortState.key}`,
    entries,
    entryMeta,
    requestMeta: fileManager.requestEntryMeta,
  });
  const blockReveal = needsMetaPrefetch && !metaReady;

  const { sortedEntries, totalCount, visibleCount, isFiltered } = useFilteredEntries({
    entries,
    entryMeta,
    searchValue: deferredSearchValue,
    sortState,
    metaReady,
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
  const viewPath = activeTab?.path ?? currentPath;
  const scrollKey = `${activeTabId ?? "none"}:${viewMode}:${viewPath}:${deferredSearchValue.trim()}`;
  const initialScrollTop = getScrollTop(scrollKey);
  const contextMenuActive = Boolean(contextMenu);
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
    entries: sortedEntries,
    parentPath: viewParentPath,
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
    tabSession.newTab();
    return true;
  }, [canHandleGlobalKeybind, tabSession]);

  const handleCloseTabKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleGlobalKeybind()) return false;
    if (!activeTabId) return false;
    tabSession.closeTab(activeTabId);
    return true;
  }, [activeTabId, canHandleGlobalKeybind, tabSession]);

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
      tabSession.selectTab(target.id);
      return true;
    },
    [activeTabId, canHandleGlobalKeybind, tabSession],
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
    return true;
  }, [canHandleViewKeybind, selectionTargets]);

  const handlePasteSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    const clipboard = useClipboardStore.getState().clipboard;
    if (!clipboard || clipboard.paths.length === 0) return false;
    void fileManager.duplicateEntries(clipboard.paths);
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
    () => ({
      F5: handleRefreshKeybind,
      "Control+c": handleCopySelectionKeybind,
      "Control+v": handlePasteSelectionKeybind,
    }),
    [handleCopySelectionKeybind, handlePasteSelectionKeybind, handleRefreshKeybind],
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
    totalCount,
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
  const sortMenuItems = useSortMenuItems(sortState, tabSession.setSort);
  const entryMenuItems = useEntryMenuItems({
    target: contextMenu?.kind === "entry" ? contextMenu.entry : null,
    selected,
    parentPath: viewParentPath,
    onOpenEntry: fileManager.openEntry,
    onOpenDir: browseFromView,
    onDeleteEntries: fileManager.deleteEntries,
    onClearSelection: clearSelection,
  });
  const contextMenuItems =
    contextMenu?.kind === "entry" ? entryMenuItems : sortMenuItems;
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
          onSelectNewTab: tabSession.openInNewTab,
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
          onSelect: tabSession.selectTab,
          onClose: tabSession.closeTab,
          onNew: tabSession.newTab,
          onReorder: tabSession.reorderTabs,
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
          onSelectNewTab: tabSession.openInNewTab,
        }}
        mainRef={mainRef}
        onContextMenu={handleLayoutContextMenu}
        fileViewProps={{
          viewMode,
          entries: sortedEntries,
          loading,
          parentPath: viewParentPath,
          searchQuery: deferredSearchValue,
          scrollKey,
          initialScrollTop,
          scrollRequest,
          selectedPaths: selected,
          onSetSelection: setSelection,
          onOpenDir: browseFromView,
          onOpenDirNewTab: tabSession.openInNewTab,
          onOpenEntry: fileManager.openEntry,
          onSelectItem: handleSelectItem,
          onClearSelection: clearSelection,
          onScrollTopChange: setScrollTop,
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
          blockReveal,
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
