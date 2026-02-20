// App shell wiring: composes state hooks, layout blocks, and overlays.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppOverlays, AppShellLayout } from "@/components";
import {
  useAppCommands,
  useAppContextMenuSection,
  useConversionController,
  useAppEffects,
  useAppFileViewController,
  useAppKeybinds,
  useAppNavigationController,
  useAppMenuState,
  useAppOverlaySection,
  useAppPreviewSection,
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
import { usePlacesStore, usePromptStore } from "@/modules";
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
    openPlaceTargetMenu,
    closeContextMenu,
    toggleSettings,
    closeSettings,
  } = useAppMenuState();
  const tauriEnv = isTauriEnv();
  const promptOpen = usePromptStore((state) => Boolean(state.prompt));
  const [, setSuppressExternalPresence] = useState(false);
  const [thumbResetNonce, setThumbResetNonce] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const places = usePlacesStore((state) => state.places);
  const placesInitialized = usePlacesStore((state) => state.initialized);
  const seedDefaultPlaces = usePlacesStore((state) => state.seedDefaults);
  const addPlace = usePlacesStore((state) => state.addPlace);
  const pinPlace = usePlacesStore((state) => state.pinPlace);
  const unpinPlace = usePlacesStore((state) => state.unpinPlace);
  const removePlace = usePlacesStore((state) => state.removePlace);
  const { currentPath, parentPath, entries, entryMeta, totalCount, loading, status } =
    fileManager;

  useEffect(() => {
    if (placesInitialized) return;
    if (!fileManager.placesLoaded) return;
    seedDefaultPlaces(fileManager.places);
  }, [fileManager.places, fileManager.placesLoaded, placesInitialized, seedDefaultPlaces]);
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
  const activeSearch = activeTab?.search ?? "";
  const activeTabPath = activeTab?.path ?? "";
  const viewPath = activeTabPath || currentPath;
  // Keep a per-tab trail so breadcrumb crumbs can show the deepest path visited.
  const crumbTrailPath = activeTab?.crumbTrailPath ?? viewPath;
  const viewPathKey = normalizePath(viewPath ?? "");
  const currentPathKey = normalizePath(currentPath);
  // When a tab switch happens before the new directory load finishes,
  // reuse cached entries to avoid a visible loading flash.
  const viewPending = Boolean(viewPathKey) && viewPathKey !== currentPathKey;
  const cachedView =
    viewPending && viewPathKey
      ? fileManager.peekDirCache(viewPath, { sort: sortState, search: activeSearch })
      : null;
  const viewLoading = viewPending ? loading && !cachedView : loading;
  const viewEntries = viewPending ? cachedView?.entries ?? [] : entries;
  const viewTotalCount = viewPending ? cachedView?.totalCount ?? 0 : totalCount;
  const viewParentPathBase = viewPending ? cachedView?.parentPath ?? null : parentPath;
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
    parentPath: viewParentPathBase,
    loading: viewLoading,
    jumpTo: tabSession.jumpTo,
    browseTo: tabSession.browseTo,
  });
  const { flushPersist: flushWindowSize } = useWindowSize();
  // Check available shells once so future actions can choose a supported target.
  const shellAvailability = useShellAvailability({ enabled: tauriEnv });
  const ffmpegDetected =
    Boolean(shellAvailability?.ffmpeg) || settings.ffmpegPath.trim().length > 0;
  const {
    conversionModalOpen,
    conversionModalState,
    openConversionModal,
    closeConversionModal,
    handleConversionDraftChange,
    handleStartConversion,
    handleQuickConvertImages,
  } = useConversionController({
    deleteEntries: fileManager.deleteEntries,
    refreshEntries: fileManager.refresh,
    ffmpegPath: settings.ffmpegPath,
  });

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
    canGoDown,
    handleDown,
  } = useAppNavigationController({
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
    browseFromView,
    viewPath,
    crumbTrailPath,
  });

  // Thumbnail pipeline input config.
  const thumbnailOptions = useMemo(
    () => ({
      size: settings.thumbnailSize,
      quality: settings.thumbnailQuality,
      format: settings.thumbnailFormat,
      allowVideos: settings.thumbnailVideos,
      allowSvgs: settings.thumbnailSvgs,
      cacheMb: settings.thumbnailCacheMb,
    }),
    [
      settings.thumbnailCacheMb,
      settings.thumbnailFormat,
      settings.thumbnailQuality,
      settings.thumbnailSize,
      settings.thumbnailSvgs,
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
  const metaPrefetchKey = `${viewPathKey}:${sortState.key}:${sortState.dir}:${deferredSearchValue}`;
  const shouldPrefetchMeta = sortState.key !== "name";
  useMetaPrefetch({
    enabled: shouldPrefetchMeta,
    loading: viewLoading,
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
  const smartTabBlocked =
    promptOpen || settingsOpen || aboutOpen || conversionModalOpen || contextMenuActive;
  // Keep clipboard state synced with OS file copy/cut payloads.
  const { refreshFromOs: refreshClipboardFromOs } = useClipboardSync({
    enabled: tauriEnv,
    contextMenuOpen: contextMenuActive,
  });
  const viewModel = useFileViewModel(sortedEntries, viewParentPath);
  const requestScrollToIndexForView = useCallback(
    (index: number) => requestScrollToIndex(index, viewKey),
    [requestScrollToIndex, viewKey],
  );
  // Preview section keeps media-preview wiring isolated from layout composition.
  const {
    previewOpenRef,
    previewOpen,
    previewPath,
    previewMeta,
    openPreview,
    handlePreviewPress,
    handlePreviewRelease,
  } = useAppPreviewSection({
    entryByPath: viewModel.entryByPath,
    mainRef,
    previewKeybind: settings.keybinds.previewItem,
    settingsOpen,
    contextMenuOpen: contextMenuActive,
    promptOpen,
    loading: viewLoading,
    entryMeta,
  });

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
    previewOpenRef,
    blockReveal,
    loading: viewLoading,
    settingsOpen,
    promptOpen,
    contextMenuOpen: contextMenuActive,
    mainRef,
    requestScrollToIndex: requestScrollToIndexForView,
  });

  const handlePreviewSelect = useCallback(
    (path: string) => {
      if (!path) return;
      setSelection([path], path);
      openPreview(path);
    },
    [openPreview, setSelection],
  );
  const handleSelectAll = useCallback(() => {
    if (selectionItems.length === 0) return;
    // Keep selection order aligned with the rendered view model.
    setSelection(selectionItems, selectionItems[0]);
  }, [selectionItems, setSelection]);

  const {
    renameTarget,
    renameValue,
    setRenameTarget,
    setRenameValue,
    handleRenameCommit,
    handleRenameCancel,
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
  // Manual refresh should clear selection first; internal/background refreshes stay untouched.
  const handleManualRefresh = useCallback(() => {
    handleClearSelection();
    handleRefresh();
  }, [handleClearSelection, handleRefresh]);
  const handleOpenRecycleBin = useCallback(() => {
    // Windows shell namespace target for the system Recycle Bin.
    void fileManager.openEntry("shell:RecycleBinFolder");
  }, [fileManager.openEntry]);

  const { queueCreateSelection } = usePendingCreateSelection({
    viewKey,
    viewPathKey,
    viewLoading,
    indexMap: viewModel.indexMap,
    onSelectionChange: handleSelectionChange,
    onScrollToIndex: requestScrollToIndexForView,
  });

  // Disable entry presence transitions so list/grid updates paint immediately.
  const presenceEnabled = false;

  // Centralize app-wide side effects so they are easy to audit.
  useAppEffects({
    isTauriEnv: tauriEnv,
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
      contextMenuOpen: contextMenuActive,
    },
    actions: {
      clearSearchAndFocusView,
      setSearchValue,
      setTabSearch: tabSession.setSearch,
      flushWindowSize,
      loadDir: fileManager.loadDir,
      requestEntryMeta: fileManager.requestEntryMeta,
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
    handlePlaceTargetContextMenu,
    handlePlaceTargetContextMenuDown,
    handleLayoutContextMenu,
    handleLayoutContextMenuDown,
    handleEntryContextMenu,
    handleEntryContextMenuDown,
  } = useAppContextMenuSection({
    contextMenu,
    openSortMenu,
    openEntryMenu,
    openPlaceTargetMenu,
    closeContextMenu,
    selected,
    entryByPath: viewModel.entryByPath,
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
    menuShowConvert: settings.menuShowConvert,
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
    onOpenConvertModal: openConversionModal,
    onQuickConvertImages: handleQuickConvertImages,
    ffmpegDetected,
    places,
    onAddPlace: addPlace,
    onPinPlace: pinPlace,
    onUnpinPlace: unpinPlace,
    onRemovePlace: removePlace,
    onRemoveRecentJump: tabSession.removeRecentJump,
  });

  useSelectionShortcuts({
    blockReveal,
    previewOpen,
    contextMenuOpen: contextMenuActive,
    loading: viewLoading,
    settingsOpen,
    smartTabBlocked,
    viewMode,
    smartTabJump: settings.smartTabJump,
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
    conversionModalOpen,
    contextMenuOpen: contextMenuActive,
    promptOpen,
    previewOpen,
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
    onRefresh: handleManualRefresh,
    onClearSelection: handleClearSelection,
    onSelectAll: handleSelectAll,
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

  // Package topstack wiring so the layout block stays readable.
  const topstackProps = useAppTopstackProps({
    appName: APP_NAME,
    topstackRef,
    pathBar: {
      onBack: handleBack,
      onForward: handleForward,
      onUp: handleUp,
      onDown: handleDown,
      canGoBack,
      canGoForward,
      canGoUp,
      canGoDown,
      loading,
    },
    pathInputsBar: {
      path: pathValue,
      search: searchValue,
      onPathChange: setPathValue,
      onSearchChange: setSearchValue,
      onSubmit: handleGo,
      onRefresh: handleManualRefresh,
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
      onTabContextMenu: handlePlaceTargetContextMenu,
      onTabContextMenuDown: handlePlaceTargetContextMenuDown,
    },
    crumbsBar: {
      path: viewPath,
      trailPath: crumbTrailPath,
      dropTargetPath,
      onNavigate: browseFromView,
      onNavigateNewTab: handleOpenInNewTab,
      onCrumbContextMenu: handlePlaceTargetContextMenu,
      onCrumbContextMenuDown: handlePlaceTargetContextMenuDown,
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
      onOpenRecycleBin: handleOpenRecycleBin,
    },
  });
  const { fileViewProps, layoutClass, layoutContextMenu, layoutContextMenuDown } =
    useAppFileViewController({
      sidebarOpen,
      showLander,
      showEmptyFolder,
      onLayoutContextMenu: handleLayoutContextMenu,
      onLayoutContextMenuDown: handleLayoutContextMenuDown,
      fileViewOptions: {
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
          places,
          onOpenPlace: handleSelectPlace,
          onOpenPlaceNewTab: handleOpenInNewTab,
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
          thumbnailFolders: settings.thumbnailFolders,
          thumbnailVideos: settings.thumbnailVideos,
          thumbnailSvgs: settings.thumbnailSvgs,
          categoryTinting: settings.categoryTinting,
          thumbResetKey: thumbnailResetKey,
          presenceEnabled,
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
          onContextMenu: handleLayoutContextMenu,
          onContextMenuDown: handleLayoutContextMenuDown,
          onEntryContextMenu: handleEntryContextMenu,
          onEntryContextMenuDown: handleEntryContextMenuDown,
        },
        dragDrop: {
          dropTargetPath,
          onStartDragOut: handleStartDragOut,
          onInternalDrop: handleInternalDrop,
          onInternalHover: handleInternalHover,
        },
        preview: {
          onEntryPreviewPress: handlePreviewPress,
          onEntryPreviewRelease: handlePreviewRelease,
        },
        sort: {
          onSortChange: handleSortChange,
        },
      },
    });

  const overlayProps = useAppOverlaySection({
    appMeta: {
      isTauriEnv: tauriEnv,
      appName: APP_NAME,
      description: APP_DESCRIPTION,
      version: APP_VERSION,
    },
    about: {
      open: aboutOpen,
      onClose: handleCloseAbout,
    },
    contextMenu: {
      state: contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null,
      open: contextMenuOpen,
      items: contextMenuItems,
      onClose: closeContextMenu,
    },
    quickPreview: {
      open: previewOpen,
      path: previewPath,
      meta: previewMeta,
      items: sortedEntries,
      entryMeta,
      thumbnails,
      thumbnailsEnabled: settings.thumbnailsEnabled,
      onRequestMeta: fileManager.requestEntryMeta,
      onRequestThumbs: requestThumbnails,
      thumbResetKey: thumbnailResetKey,
      loading: viewLoading,
      onSelectPreview: handlePreviewSelect,
      smartTabJump: settings.smartTabJump,
      smartTabBlocked,
    },
    settings: {
      open: settingsOpen,
      onClose: closeSettings,
      onOpenCacheLocation: handleOpenThumbCache,
      onClearCache: handleClearThumbCache,
    },
    conversion: {
      open: conversionModalState.open,
      request: conversionModalState.request,
      draft: conversionModalState.uiDraft,
      runState: conversionModalState.run,
      onDraftChange: handleConversionDraftChange,
      onConvert: handleStartConversion,
      onClose: closeConversionModal,
    },
  });

  return (
    <div className="app-shell" data-preview={previewOpen ? "true" : "false"}>
      <AppShellLayout
        topstack={topstackProps}
        content={{
          layoutClass,
          sidebarOpen,
          sidebarProps: {
            places,
            recentJumps: tabSession.recentJumps,
            activePath: currentPath,
            dropTargetPath,
            sectionOrder: settings.sidebarSectionOrder,
            hiddenSections: settings.sidebarHiddenSections,
            onSelect: handleSelectPlace,
            onSelectRecent: tabSession.jumpTo,
            onSelectNewTab: handleOpenInNewTab,
            onPlaceContextMenu: handlePlaceTargetContextMenu,
            onPlaceContextMenuDown: handlePlaceTargetContextMenuDown,
            onRecentContextMenu: handlePlaceTargetContextMenu,
            onRecentContextMenuDown: handlePlaceTargetContextMenuDown,
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
      <AppOverlays {...overlayProps} />
    </div>
  );
};

export default App;
