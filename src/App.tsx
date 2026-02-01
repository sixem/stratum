// App shell wiring: composes state hooks, layout blocks, and overlays.
import { useCallback, useMemo, useRef, useState } from "react";
import { AppOverlays, AppShellLayout } from "@/components";
import {
  useAppCommands,
  useAppContextMenus,
  useAppEffects,
  useAppKeybinds,
  useAppHandlers,
  useAppFileViewProps,
  useAppMenuState,
  useAppRenameFlow,
  useAppSelectionHandlers,
  useAppTopstackProps,
  useAppViewState,
  useClipboardSync,
  useDragOutHandler,
  useDriveInfo,
  useFileDrop,
  useFileManager,
  useFileViewInteractions,
  useFileViewModel,
  useFilteredEntries,
  useMetaPrefetch,
  usePendingCreateSelection,
  useScrollRequest,
  useSelectionShortcuts,
  useShellAvailability,
  useSettings,
  useStatusLabels,
  useTabSession,
  useThumbnails,
  useWindowSize,
} from "@/hooks";
import { makeDebug, normalizePath } from "@/lib";
import { usePromptStore } from "@/modules";
import { APP_DESCRIPTION, APP_NAME, APP_VERSION } from "@/constants";
import "@/styles/app.scss";

const viewLog = makeDebug("view");
const isTauriEnv = () => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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
  const [suppressExternalPresence, setSuppressExternalPresence] = useState(false);
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
  const activeTabPath = activeTab?.path ?? "";
  const { flushPersist: flushWindowSize } = useWindowSize();
  // Check available shells once so future actions can choose a supported target.
  const shellAvailability = useShellAvailability({ enabled: isTauriEnv() });

  // Bundle navigation + layout handlers so wiring stays focused on data flow.
  const {
    stashActiveScroll,
    handleSelectDrive,
    handleSelectPlace,
    handleSelectTab,
    handleCloseTab,
    handleNewTab,
    handleOpenInNewTab,
    handleToggleSidebar,
    handleOpenAbout,
    handleCloseAbout,
    handleRefresh,
    handleBack,
    handleForward,
    handleSortChange,
  } = useAppHandlers({
    activeTabId,
    activeTabPath,
    currentPath,
    loading,
    activeSearch,
    mainRef,
    refresh: fileManager.refresh,
    loadDir: fileManager.loadDir,
    jumpTo: tabSession.jumpTo,
    selectTab: tabSession.selectTab,
    closeTab: tabSession.closeTab,
    newTab: tabSession.newTab,
    openInNewTab: tabSession.openInNewTab,
    setSort: tabSession.setSort,
    setTabScrollTop: tabSession.setTabScrollTop,
    goBack,
    goForward,
    sidebarOpen,
    updateSettings: settings.updateSettings,
    setAboutOpen,
  });

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

  const {
    renameTarget,
    renameValue,
    setRenameTarget,
    setRenameValue,
    handleRenameCommit,
    handleRenameCancel,
    suppressInternalPresence,
  } = useAppRenameFlow({
    entries,
    entryByPath: viewModel.entryByPath,
    indexMap: viewModel.indexMap,
    selected,
    viewParentPath,
    gridNameHideExtension: settings.gridNameHideExtension,
    renameEntry: fileManager.renameEntry,
    renameEntries: fileManager.renameEntries,
    setSelection,
  });

  const {
    handleSelectionChange,
    handleClearSelection,
    handleSelectItemWithRename,
    handleRenameStart,
  } = useAppSelectionHandlers({
    renameTarget,
    selected,
    gridNameHideExtension: settings.gridNameHideExtension,
    setSelection,
    clearSelection,
    handleSelectItem,
    handleRenameCommit,
    setRenameTarget,
    setRenameValue,
  });

  const { queueCreateSelection } = usePendingCreateSelection({
    viewKey,
    viewPathKey,
    viewLoading,
    indexMap: viewModel.indexMap,
    onSelectionChange: handleSelectionChange,
    onScrollToIndex: requestScrollToIndexForView,
  });

  const suppressPresence = suppressInternalPresence || suppressExternalPresence;

  // Centralize app-wide side effects so they are easy to audit.
  useAppEffects({
    isTauriEnv: isTauriEnv(),
    appName: APP_NAME,
    appVersion: APP_VERSION,
    refs: {
      topstackRef,
      statusbarRef,
      searchInputRef,
      lastViewRef,
    },
    settings: {
      confirmClose: settings.confirmClose,
      accentTheme: settings.accentTheme,
      ambientBackground: settings.ambientBackground,
      blurOverlays: settings.blurOverlays,
      gridRounded: settings.gridRounded,
      gridCentered: settings.gridCentered,
      compactMode: settings.compactMode,
    },
    view: {
      activeTabId,
      activeTabPath,
      activeSearch,
      searchValue,
      currentPath,
      viewPath: viewPath ?? "",
      viewPathKey,
      viewMode,
      loading,
      sidebarOpen,
      deferredSearchValue,
      sortState,
      tabs,
    },
    actions: {
      clearSearchAndFocusView,
      setSearchValue,
      setTabSearch: tabSession.setSearch,
      flushWindowSize,
      loadDir: fileManager.loadDir,
      clearDir: fileManager.clearDir,
      setRenameTarget,
      setRenameValue,
      setTabScrollTop: tabSession.setTabScrollTop,
      stashActiveScroll,
      onPresenceToggle: setSuppressExternalPresence,
    },
    shouldResetScroll,
    viewLog,
  });

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

  // Bundle filesystem + shell commands so view wiring stays readable.
  const {
    handleCreateFile,
    handleCreateFolder,
    handleCreateFolderAndGo,
    handleOpenShell,
    handleInternalDrop,
    handleInternalHover,
    handleOpenThumbCache,
    handleClearThumbCache,
  } = useAppCommands({
    browseFromView,
    queueCreateSelection,
    createFile: fileManager.createFile,
    createFolder: fileManager.createFolder,
    performDrop,
    setDropTarget,
    setThumbResetNonce,
  });

  const handleStartDragOut = useDragOutHandler({
    viewParentPath,
    onRefresh: fileManager.refresh,
  });
  const {
    contextMenuItems,
    contextMenuOpen,
    handleLayoutContextMenu,
    handleLayoutContextMenuDown,
    handleEntryContextMenu,
    handleEntryContextMenuDown,
  } = useAppContextMenus({
    contextMenu,
    openSortMenu,
    openEntryMenu,
    closeContextMenu,
    selected,
    onSelectionChange: handleSelectionChange,
    currentPath,
    viewParentPath,
    sortState,
    onSortChange: handleSortChange,
    onPaste: (paths) => {
      void fileManager.pasteEntries(paths);
    },
    onCreateFolder: handleCreateFolder,
    onCreateFolderAndGo: handleCreateFolderAndGo,
    onCreateFile: handleCreateFile,
    shellAvailability,
    menuOpenPwsh: settings.menuOpenPwsh,
    menuOpenWsl: settings.menuOpenWsl,
    onOpenShell: handleOpenShell,
    onOpenEntry: fileManager.openEntry,
    onOpenDir: browseFromView,
    onDeleteEntries: fileManager.deleteEntries,
    confirmDelete: settings.confirmDelete,
    onClearSelection: handleClearSelection,
    onRenameEntry: handleRenameStart,
    onPasteEntries: (paths, destination) => {
      void fileManager.pasteEntries(paths, destination);
    },
  });

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

  useAppKeybinds({
    keybinds: settings.keybinds,
    confirmDelete: settings.confirmDelete,
    settingsOpen,
    contextMenuOpen: contextMenuActive,
    promptOpen,
    blockReveal,
    activeTabId,
    tabs,
    selected,
    viewParentPath,
    canUndo: fileManager.canUndo,
    undo: fileManager.undo,
    deleteEntries: fileManager.deleteEntries,
    duplicateEntries: fileManager.duplicateEntries,
    pasteEntries: fileManager.pasteEntries,
    refreshClipboardFromOs,
    onNewTab: handleNewTab,
    onCloseTab: handleCloseTab,
    onSelectTab: handleSelectTab,
    onRefresh: handleRefresh,
    onClearSelection: handleClearSelection,
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

  // Layout class toggles full-width mode when the sidebar is closed.
  const layoutClass = `layout${sidebarOpen ? "" : " is-full"}`;
  // Gate the shared context menu handlers when the lander/empty state is showing.
  const layoutContextMenu =
    showLander || showEmptyFolder ? undefined : handleLayoutContextMenu;
  const layoutContextMenuDown =
    showLander || showEmptyFolder ? undefined : handleLayoutContextMenuDown;
  // Package topstack wiring so the layout block stays readable.
  const topstackProps = useAppTopstackProps({
    appName: APP_NAME,
    topstackRef,
    pathBar: {
      onBack: handleBack,
      onForward: handleForward,
      onUp: handleUp,
      canGoBack,
      canGoForward,
      canGoUp,
      loading,
    },
    pathInputsBar: {
      path: pathValue,
      search: searchValue,
      onPathChange: setPathValue,
      onSearchChange: setSearchValue,
      onSubmit: handleGo,
      onRefresh: handleRefresh,
      loading,
      searchInputRef,
    },
    tabsBar: {
      tabs: tabSession.tabs,
      activeId: activeTabId,
      dropTargetId: dropTargetTabId,
      onSelect: handleSelectTab,
      onClose: handleCloseTab,
      onNew: handleNewTab,
      onReorder: tabSession.reorderTabs,
      showTabNumbers: settings.showTabNumbers,
      fixedWidthTabs: settings.fixedWidthTabs,
    },
    crumbsBar: {
      path: viewPath,
      trailPath: crumbTrailPath,
      dropTargetPath,
      onNavigate: browseFromView,
      onNavigateNewTab: handleOpenInNewTab,
    },
    sidebarOpen,
    onToggleSidebar: handleToggleSidebar,
    onOpenAbout: handleOpenAbout,
    drivePicker: {
      activePath: viewPath ?? "",
      drives: fileManager.drives,
      driveInfo: fileManager.driveInfo,
      onSelect: handleSelectDrive,
      onSelectNewTab: handleOpenInNewTab,
    },
    pathBarActions: {
      viewMode,
      settingsOpen,
      onViewChange: tabSession.setViewMode,
      onToggleSettings: toggleSettings,
    },
  });
  // Collect file view wiring so the layout block stays readable.
  const fileViewProps = useAppFileViewProps({
    view: {
      currentPath: viewPath ?? "",
      viewMode,
      entries: sortedEntries,
      items: viewModel.items,
      indexMap: viewModel.indexMap,
      loading: viewLoading,
      showLander,
      searchQuery: deferredSearchValue,
      viewKey,
      scrollRestoreKey,
      scrollRestoreTop,
      scrollRequest,
      smoothScroll: settings.smoothScroll,
      compactMode: settings.compactMode,
      sortState,
      canGoUp,
    },
    navigation: {
      recentJumps: tabSession.recentJumps,
      onOpenRecent: browseFromView,
      onOpenRecentNewTab: handleOpenInNewTab,
      drives: fileManager.drives,
      driveInfo: fileManager.driveInfo,
      onOpenDrive: handleSelectDrive,
      onOpenDriveNewTab: handleOpenInNewTab,
      onGoUp: handleUp,
      onOpenDir: browseFromView,
      onOpenDirNewTab: handleOpenInNewTab,
      onOpenEntry: fileManager.openEntry,
    },
    selection: {
      selectedPaths: selected,
      onSetSelection: handleSelectionChange,
      onSelectItem: handleSelectItemWithRename,
      onClearSelection: handleClearSelection,
    },
    creation: {
      onCreateFolder: handleCreateFolder,
      onCreateFolderAndGo: handleCreateFolderAndGo,
      onCreateFile: handleCreateFile,
    },
    rename: {
      renameTargetPath: renameTarget?.path ?? null,
      renameValue,
      onRenameChange: setRenameValue,
      onRenameCommit: handleRenameCommit,
      onRenameCancel: handleRenameCancel,
    },
    metadata: {
      entryMeta,
      onRequestMeta: fileManager.requestEntryMeta,
    },
    thumbnails: {
      thumbnailsEnabled: settings.thumbnailsEnabled,
      thumbnails,
      onRequestThumbs: requestThumbnails,
      thumbnailFit: settings.thumbnailFit,
      thumbnailAppIcons: settings.thumbnailAppIcons,
      categoryTinting: settings.categoryTinting,
      thumbResetKey: thumbnailResetKey,
      presenceEnabled: !suppressPresence,
    },
    grid: {
      gridSize: settings.gridSize,
      gridAutoColumns: settings.gridAutoColumns,
      gridGap: settings.gridGap,
      gridShowSize: settings.gridShowSize,
      gridShowExtension: settings.gridShowExtension,
      gridNameEllipsis: settings.gridNameEllipsis,
      gridNameHideExtension: settings.gridNameHideExtension,
      onGridColumnsChange: handleGridColumnsChange,
    },
    contextMenu: {
      onContextMenu: layoutContextMenu,
      onContextMenuDown: layoutContextMenuDown,
      onEntryContextMenu: handleEntryContextMenu,
      onEntryContextMenuDown: handleEntryContextMenuDown,
    },
    dragDrop: {
      dropTargetPath,
      onStartDragOut: handleStartDragOut,
      onInternalDrop: handleInternalDrop,
      onInternalHover: handleInternalHover,
    },
    sort: {
      onSortChange: handleSortChange,
    },
  });


  return (
    <div className="app-shell">
      <AppShellLayout
        topstack={topstackProps}
        content={{
          layoutClass,
          sidebarOpen,
          sidebarProps: {
            places: fileManager.places,
            recentJumps: tabSession.recentJumps,
            activePath: currentPath,
            sectionOrder: settings.sidebarSectionOrder,
            hiddenSections: settings.sidebarHiddenSections,
            onSelect: handleSelectPlace,
            onSelectRecent: tabSession.jumpTo,
            onSelectNewTab: handleOpenInNewTab,
          },
          mainRef,
          onContextMenu: layoutContextMenu,
          onContextMenuDown: layoutContextMenuDown,
          fileViewProps,
        }}
        statusbar={{
          statusbarRef,
          statusBar: {
            message: status.message,
            level: status.level,
            countLabel,
            selectionLabel,
          },
          hidden: showLander,
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
