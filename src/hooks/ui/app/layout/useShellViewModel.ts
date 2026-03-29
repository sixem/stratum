// Owns the heavy view-layer orchestration for the app shell.
// This keeps useAppShellModel focused on composition while the file view,
// preview, selection, commands, and shortcuts stay grouped here.
import { useCallback, useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Place } from "@/types";
import { APP_NAME, APP_VERSION } from "@/constants";
import {
  useClipboardSync,
  useDriveInfo,
  useFileDrop,
  useFileManager,
  useShellAvailability,
} from "@/hooks/domain/filesystem";
import {
  useFilteredEntries,
  useMetaPrefetch,
  useStatusLabels,
  useThumbnails,
} from "@/hooks/domain/metadata";
import type { useSettings, useTabSession } from "@/hooks/domain/session";
import type { useScrollRequest } from "@/hooks/perf/scroll";
import { useDragOutHandler } from "@/hooks/ui/inputs";
import { useSelectionShortcuts } from "@/hooks/ui/selection";
import { useFileViewInteractions, useFileViewModel } from "@/hooks/ui/view";
import { useAppCommands } from "../useAppCommands";
import { useAppContextMenuSection } from "../useAppContextMenuSection";
import { useAppEffects } from "../useAppEffects";
import { useAppFileViewController } from "../useAppFileViewController";
import { useAppKeybinds } from "../useAppKeybinds";
import type { useAppMenuState } from "../useAppMenuState";
import type { useAppNavigationController } from "../useAppNavigationController";
import { useAppPreviewSection } from "../useAppPreviewSection";
import { useAppRenameFlow } from "../useAppRenameFlow";
import { useAppSelectionHandlers } from "../useAppSelectionHandlers";
import type { useAppViewState } from "../useAppViewState";
import { useConversionController } from "../useConversionController";
import { usePendingCreateSelection } from "../usePendingCreateSelection";
import { resolveShellViewState } from "./resolveShellViewState";

type FileManagerModel = ReturnType<typeof useFileManager>;
type SettingsModel = ReturnType<typeof useSettings>;
type TabSessionModel = ReturnType<typeof useTabSession>;
type FileDropModel = ReturnType<typeof useFileDrop>;
type ScrollStateModel = ReturnType<typeof useScrollRequest>;
type MenuStateModel = ReturnType<typeof useAppMenuState>;
type NavigationControllerModel = ReturnType<typeof useAppNavigationController>;
type ViewStateModel = ReturnType<typeof useAppViewState>;
type ResolvedViewState = ReturnType<typeof resolveShellViewState>;

type UseShellViewModelOptions = {
  tauriEnv: boolean;
  promptOpen: boolean;
  aboutOpen: boolean;
  menuState: MenuStateModel;
  fileManager: FileManagerModel;
  settings: SettingsModel;
  tabSession: TabSessionModel;
  fileDrop: FileDropModel;
  scrollState: ScrollStateModel;
  flushWindowSize: () => void;
  lastViewRef: MutableRefObject<{ tabId: string | null; pathKey: string } | null>;
  setSuppressExternalPresence: Dispatch<SetStateAction<boolean>>;
  thumbResetNonce: number;
  setThumbResetNonce: Dispatch<SetStateAction<number>>;
  resolvedView: ResolvedViewState;
  viewState: ViewStateModel;
  navigationController: NavigationControllerModel;
  places: Place[];
  addPlace: (path: string) => void;
  pinPlace: (path: string) => void;
  unpinPlace: (path: string) => void;
  removePlace: (path: string) => void;
  viewLog: (...args: unknown[]) => void;
};

export const useShellViewModel = ({
  tauriEnv,
  promptOpen,
  aboutOpen,
  menuState,
  fileManager,
  settings,
  tabSession,
  fileDrop,
  scrollState,
  flushWindowSize,
  lastViewRef,
  setSuppressExternalPresence,
  thumbResetNonce,
  setThumbResetNonce,
  resolvedView,
  viewState,
  navigationController,
  places,
  addPlace,
  pinPlace,
  unpinPlace,
  removePlace,
  viewLog,
}: UseShellViewModelOptions) => {
  const contextMenuActive = Boolean(menuState.contextMenu);
  const blockReveal = resolvedView.viewLoading;

  // Thumbnail and metadata pipelines derive from the resolved view rather than raw directory state.
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
  const thumbnailResetKey = `reset:${thumbResetNonce}`;
  const { thumbnails, requestThumbnails } = useThumbnails(
    thumbnailOptions,
    settings.thumbnailsEnabled,
    thumbnailResetKey,
  );

  const { sortedEntries, visibleCount, isFiltered, totalCount: resolvedTotalCount } =
    useFilteredEntries({
      entries: resolvedView.viewEntries,
      searchValue: viewState.deferredSearchValue,
      totalCount: resolvedView.viewTotalCount,
    });
  const showEmptyFolder =
    !resolvedView.showLander &&
    !resolvedView.viewLoading &&
    resolvedView.viewEntries.length === 0 &&
    viewState.deferredSearchValue.trim().length === 0;
  const viewParentPath =
    resolvedView.viewParentPathBase &&
    resolvedView.canGoUp &&
    settings.showParentEntry &&
    !isFiltered &&
    !showEmptyFolder
      ? resolvedView.viewParentPathBase
      : null;
  const metaPrefetchKey = `${resolvedView.viewPathKey}:${resolvedView.sortState.key}:${resolvedView.sortState.dir}:${viewState.deferredSearchValue}`;
  useMetaPrefetch({
    enabled: resolvedView.sortState.key !== "name",
    loading: resolvedView.viewLoading,
    resetKey: metaPrefetchKey,
    entries: sortedEntries,
    entryMeta: fileManager.entryMeta,
    requestMeta: fileManager.requestEntryMeta,
    // Defer non-visible updates so scrolling stays responsive.
    deferUpdates: true,
    flushMeta: fileManager.flushEntryMeta,
  });

  const { currentDriveInfo } = useDriveInfo({
    currentPath: fileManager.currentPath,
    drives: fileManager.drives,
    driveInfo: fileManager.driveInfo,
  });
  const { refreshFromOs: refreshClipboardFromOs } = useClipboardSync({
    enabled: tauriEnv,
    contextMenuOpen: contextMenuActive,
  });
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
    refreshEntries: fileManager.refresh,
    ffmpegPath: settings.ffmpegPath,
  });
  const smartTabBlocked =
    promptOpen ||
    menuState.settingsOpen ||
    aboutOpen ||
    conversionModalOpen ||
    contextMenuActive;

  const viewModel = useFileViewModel(sortedEntries, viewParentPath);
  const requestScrollToIndexForView = useCallback(
    (index: number) => scrollState.requestScrollToIndex(index, resolvedView.viewKey),
    [resolvedView.viewKey, scrollState],
  );

  // Preview and selection work from the same view model so both stay in sync with cached views.
  const {
    previewOpenRef,
    previewOpen,
    previewPath,
    previewMeta,
    openPreview,
    closePreview,
    handlePreviewPress,
    handlePreviewRelease,
  } = useAppPreviewSection({
    entryByPath: viewModel.entryByPath,
    mainRef: viewState.mainRef,
    previewKeybind: settings.keybinds.previewItem,
    settingsOpen: menuState.settingsOpen,
    contextMenuOpen: contextMenuActive,
    promptOpen,
    loading: resolvedView.viewLoading,
    entryMeta: fileManager.entryMeta,
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
    activeTabId: resolvedView.activeTabId,
    currentPath: resolvedView.viewPath,
    deferredSearchValue: viewState.deferredSearchValue,
    viewMode: resolvedView.viewMode,
    previewOpenRef,
    blockReveal,
    loading: resolvedView.viewLoading,
    settingsOpen: menuState.settingsOpen,
    promptOpen,
    contextMenuOpen: contextMenuActive,
    mainRef: viewState.mainRef,
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
  const closePreviewIfOpen = useCallback(() => {
    if (!previewOpen) return false;
    closePreview();
    return true;
  }, [closePreview, previewOpen]);
  const handleSelectAll = useCallback(() => {
    if (selectionItems.length === 0) return;
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
    entries: fileManager.entries,
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

  const handleManualRefresh = useCallback(() => {
    handleClearSelection();
    navigationController.handleRefresh();
  }, [handleClearSelection, navigationController]);

  const { queueCreateSelection } = usePendingCreateSelection({
    viewKey: resolvedView.viewKey,
    viewPathKey: resolvedView.viewPathKey,
    viewLoading: resolvedView.viewLoading,
    indexMap: viewModel.indexMap,
    onSelectionChange: handleSelectionChange,
    onScrollToIndex: requestScrollToIndexForView,
  });
  const presenceEnabled = false;

  // App-level effects stay centralized here so App.tsx remains declarative.
  useAppEffects({
    isTauriEnv: tauriEnv,
    appName: APP_NAME,
    appVersion: APP_VERSION,
    refs: {
      searchInputRef: viewState.searchInputRef,
      lastViewRef,
    },
    settings: {
      confirmClose: settings.confirmClose,
      accentTheme: settings.accentTheme,
      ambientBackground: settings.ambientBackground,
      blurOverlays: settings.blurOverlays,
      gridRounded: settings.gridRounded,
      gridCentered: settings.gridCentered,
    },
    view: {
      activeTabId: resolvedView.activeTabId,
      activeTabPath: resolvedView.activeTabPath,
      activeSearch: resolvedView.activeSearch,
      searchValue: viewState.searchValue,
      currentPath: fileManager.currentPath,
      viewPath: resolvedView.viewPath,
      viewPathKey: resolvedView.viewPathKey,
      viewMode: resolvedView.viewMode,
      loading: fileManager.loading,
      sidebarOpen: resolvedView.sidebarOpen,
      deferredSearchValue: viewState.deferredSearchValue,
      sortState: resolvedView.sortState,
      tabs: resolvedView.tabs,
      contextMenuOpen: contextMenuActive,
    },
    actions: {
      clearSearchAndFocusView: viewState.clearSearchAndFocusView,
      closePreviewIfOpen,
      setSearchValue: viewState.setSearchValue,
      setTabSearch: tabSession.setSearch,
      flushWindowSize,
      loadDir: fileManager.loadDir,
      requestEntryMeta: fileManager.requestEntryMeta,
      clearDir: fileManager.clearDir,
      setRenameTarget,
      setRenameValue,
      setTabScrollTop: tabSession.setTabScrollTop,
      stashActiveScroll: navigationController.stashActiveScroll,
      onPresenceToggle: setSuppressExternalPresence,
    },
    shouldResetScroll: resolvedView.shouldResetScroll,
    viewLog,
  });

  // Command and context-menu wiring stays in the model so render props are already assembled.
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
    browseFromView: viewState.browseFromView,
    queueCreateSelection,
    createFile: fileManager.createFile,
    createFolder: fileManager.createFolder,
    performDrop: fileDrop.performDrop,
    setDropTarget: fileDrop.setDropTarget,
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
    contextMenu: menuState.contextMenu,
    openSortMenu: menuState.openSortMenu,
    openEntryMenu: menuState.openEntryMenu,
    openPlaceTargetMenu: menuState.openPlaceTargetMenu,
    closeContextMenu: menuState.closeContextMenu,
    selected,
    entryByPath: viewModel.entryByPath,
    onSelectionChange: handleSelectionChange,
    currentPath: fileManager.currentPath,
    viewParentPath,
    sortState: resolvedView.sortState,
    onSortChange: navigationController.handleSortChange,
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
    onOpenDir: viewState.browseFromView,
    onOpenDirNewTab: navigationController.handleOpenInNewTab,
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
    loading: resolvedView.viewLoading,
    settingsOpen: menuState.settingsOpen,
    smartTabBlocked,
    viewMode: resolvedView.viewMode,
    smartTabJump: settings.smartTabJump,
    mainRef: viewState.mainRef,
    gridColumnsRef,
    selectionItems,
    getSelectionIndex,
    selectItem,
    requestScrollToIndex: requestScrollToIndexForView,
    getSelectionTarget,
    onOpenDir: viewState.browseFromView,
    onOpenEntry: fileManager.openEntry,
  });

  useAppKeybinds({
    keybinds: settings.keybinds,
    confirmDelete: settings.confirmDelete,
    settingsOpen: menuState.settingsOpen,
    conversionModalOpen,
    contextMenuOpen: contextMenuActive,
    promptOpen,
    previewOpen,
    blockReveal,
    activeTabId: resolvedView.activeTabId,
    tabs: resolvedView.tabs,
    selected,
    viewParentPath,
    canUndo: fileManager.canUndo,
    undo: fileManager.undo,
    deleteEntries: fileManager.deleteEntries,
    duplicateEntries: fileManager.duplicateEntries,
    pasteEntries: fileManager.pasteEntries,
    refreshClipboardFromOs,
    onNewTab: navigationController.handleNewTab,
    onCloseTab: navigationController.handleCloseTab,
    onSelectTab: navigationController.handleSelectTab,
    onRefresh: handleManualRefresh,
    onClearSelection: handleClearSelection,
    onSelectAll: handleSelectAll,
  });

  const { countLabel, selectionLabel } = useStatusLabels({
    isFiltered,
    visibleCount,
    totalCount: resolvedTotalCount,
    currentDriveInfo,
    selected,
    entryMeta: fileManager.entryMeta,
  });

  const { fileViewProps, layoutClass, layoutContextMenu, layoutContextMenuDown } =
    useAppFileViewController({
      sidebarOpen: resolvedView.sidebarOpen,
      showLander: resolvedView.showLander,
      showEmptyFolder,
      onLayoutContextMenu: handleLayoutContextMenu,
      onLayoutContextMenuDown: handleLayoutContextMenuDown,
      fileViewOptions: {
        view: {
          currentPath: resolvedView.viewPath,
          viewMode: resolvedView.viewMode,
          entries: sortedEntries,
          items: viewModel.items,
          indexMap: viewModel.indexMap,
          loading: resolvedView.viewLoading,
          showLander: resolvedView.showLander,
          searchQuery: viewState.deferredSearchValue,
          viewKey: resolvedView.viewKey,
          scrollRestoreKey: resolvedView.viewKey,
          scrollRestoreTop: resolvedView.scrollRestoreTop,
          scrollRequest: scrollState.scrollRequest,
          smoothScroll: settings.smoothScroll,
          pendingDeletePaths: fileManager.pendingDeletePaths,
          sortState: resolvedView.sortState,
          canGoUp: resolvedView.canGoUp,
        },
        navigation: {
          recentJumps: tabSession.recentJumps,
          onOpenRecent: viewState.browseFromView,
          onOpenRecentNewTab: navigationController.handleOpenInNewTab,
          drives: fileManager.drives,
          driveInfo: fileManager.driveInfo,
          onOpenDrive: navigationController.handleSelectDrive,
          onOpenDriveNewTab: navigationController.handleOpenInNewTab,
          places,
          onOpenPlace: navigationController.handleSelectPlace,
          onOpenPlaceNewTab: navigationController.handleOpenInNewTab,
          onGoUp: viewState.handleUp,
          onOpenDir: viewState.browseFromView,
          onOpenDirNewTab: navigationController.handleOpenInNewTab,
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
          entryMeta: fileManager.entryMeta,
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
          dropTargetPath: fileDrop.dropTargetPath,
          onStartDragOut: handleStartDragOut,
          onInternalDrop: handleInternalDrop,
          onInternalHover: handleInternalHover,
        },
        preview: {
          onEntryPreviewPress: handlePreviewPress,
          onEntryPreviewRelease: handlePreviewRelease,
        },
        sort: {
          onSortChange: navigationController.handleSortChange,
        },
      },
    });

  return {
    view: {
      layoutClass,
      mainRef: viewState.mainRef,
      onContextMenu: layoutContextMenu,
      onContextMenuDown: layoutContextMenuDown,
      fileViewProps,
    },
    selection: {
      statusBar: {
        message: fileManager.status.message,
        level: fileManager.status.level,
        countLabel,
        selectionLabel,
      },
      statusHidden: resolvedView.showLander,
    },
    preview: {
      open: previewOpen,
    },
    navigationContext: {
      handleManualRefresh,
      handlePlaceTargetContextMenu,
      handlePlaceTargetContextMenuDown,
    },
    overlayContext: {
      contextMenuItems,
      contextMenuOpen,
      previewOpen,
      previewPath,
      previewMeta,
      sortedEntries,
      entryMeta: fileManager.entryMeta,
      thumbnailsEnabled: settings.thumbnailsEnabled,
      requestMeta: fileManager.requestEntryMeta,
      thumbnails,
      requestThumbnails,
      thumbnailResetKey,
      viewLoading: resolvedView.viewLoading,
      handlePreviewSelect,
      smartTabJump: settings.smartTabJump,
      smartTabBlocked,
      handleOpenThumbCache,
      handleClearThumbCache,
      conversionModalState,
      handleConversionDraftChange,
      handleStartConversion,
      closeConversionModal,
    },
  };
};
