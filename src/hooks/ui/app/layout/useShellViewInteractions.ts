// Owns selection, preview, rename, commands, and context-menu orchestration for
// the shell view. This hook intentionally works from the already-filtered data
// pipeline so interaction code can focus on user intent instead of source
// derivation.
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { ScrollAlignment } from "@/hooks/perf/scroll";
import { useDragOutHandler } from "@/hooks/ui/inputs";
import { useFileViewInteractions, useFileViewModel } from "@/hooks/ui/view";
import type { PreviewGallerySource } from "@/hooks/ui/view/useQuickPreview";
import { useAppCommands } from "../useAppCommands";
import { useAppContextMenuSection } from "../useAppContextMenuSection";
import type { ContextMenuServices } from "../useAppContextMenus";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { useAppPreviewSection } from "../useAppPreviewSection";
import { useAppRenameFlow } from "../useAppRenameFlow";
import { useAppSelectionHandlers } from "../useAppSelectionHandlers";
import { usePendingCreateSelection } from "../usePendingCreateSelection";
import type { UseShellViewModelOptions } from "./shellViewModel.types";
import type { ShellViewDataPipeline } from "./useShellViewDataPipeline";

type UseShellViewInteractionsOptions = Pick<
  UseShellViewModelOptions,
  | "tauriEnv"
  | "promptOpen"
  | "menuState"
  | "fileManager"
  | "settings"
  | "tabSession"
  | "fileDrop"
  | "scrollState"
  | "setThumbResetNonce"
  | "resolvedView"
  | "viewState"
  | "navigationController"
  | "places"
  | "addPlace"
  | "pinPlace"
  | "unpinPlace"
  | "removePlace"
> & {
  dataPipeline: ShellViewDataPipeline;
};

export const useShellViewInteractions = ({
  tauriEnv,
  promptOpen,
  menuState,
  fileManager,
  settings,
  tabSession,
  fileDrop,
  scrollState,
  setThumbResetNonce,
  resolvedView,
  viewState,
  navigationController,
  places,
  addPlace,
  pinPlace,
  unpinPlace,
  removePlace,
  dataPipeline,
}: UseShellViewInteractionsOptions) => {
  // Async file commands retain the visit that launched them. Returning to
  // the same folder later starts a new visit with its own selection.
  const viewVisit = useMemo(() => ({ current: false }), [resolvedView.viewKey]);
  useLayoutEffect(() => {
    viewVisit.current = true;
    return () => { viewVisit.current = false; };
  }, [viewVisit]);

  const viewModel = useFileViewModel(
    dataPipeline.sortedEntries,
    dataPipeline.viewParentPath,
  );
  const requestScrollToIndexForView = useCallback(
    (index: number, alignment?: ScrollAlignment) =>
      scrollState.requestScrollToIndex(index, resolvedView.viewKey, alignment),
    [resolvedView.viewKey, scrollState],
  );

  const {
    previewOpenRef,
    previewOpen,
    previewPath,
    previewMeta,
    previewGallery,
    mainPreview,
    bottomPreview,
    indexedPreview,
    openPreview,
    selectPreview: handlePreviewSelect,
    closePreview,
    handlePreviewRelease,
  } = useAppPreviewSection({
    previewKeybind: settings.keybinds.previewItem,
    settingsOpen: menuState.settingsOpen,
    contextMenuOpen: dataPipeline.contextMenuActive,
    promptOpen,
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
    getSelectionSnapshot,
    handleSelectItem,
  } = useFileViewInteractions({
    viewModel,
    activeTabId: resolvedView.activeTabId,
    currentPath: resolvedView.viewPath,
    navigationRevealPath: tabSession.navigationRevealPath,
    deferredSearchValue: viewState.deferredSearchValue,
    viewMode: resolvedView.viewMode,
    previewOpenRef,
    blockReveal: dataPipeline.blockReveal,
    loading: resolvedView.viewLoading,
    settingsOpen: menuState.settingsOpen,
    promptOpen,
    contextMenuOpen: dataPipeline.contextMenuActive,
    mainRef: viewState.mainRef,
    requestScrollToIndex: requestScrollToIndexForView,
  });

  // The gallery keeps the displayed listing from the moment it opens, even
  // when a background reload replaces the files shown in the pane.
  const currentMainGallery = useRef<PreviewGallerySource | null>(null);
  const mainGallery = useMemo<PreviewGallerySource>(() => ({
    items: dataPipeline.sortedEntries,
    entryByPath: viewModel.entryByPath,
    onSelectPath: (path) => {
      if (viewVisit.current && currentMainGallery.current?.entryByPath.has(path)) {
        setSelection([path], path);
      }
    },
  }), [dataPipeline.sortedEntries, setSelection, viewModel.entryByPath, viewVisit]);
  const registerMainPreview = mainPreview.registerSource;
  const mainRef = viewState.mainRef;
  const mainLoading = resolvedView.viewLoading;
  useLayoutEffect(() => {
    const root = mainRef.current;
    if (!root || mainLoading) return;
    currentMainGallery.current = mainGallery;
    const unregister = registerMainPreview({
      getGallery: () => mainGallery,
      paneRoot: root,
      filesRoot: root,
      isCurrent: () => viewVisit.current,
      getSelectionSnapshot,
    });
    return () => {
      unregister();
      currentMainGallery.current = null;
    };
  }, [getSelectionSnapshot, mainGallery, mainLoading, mainRef, registerMainPreview, viewVisit]);
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
    tryStartBatchRename,
  } = useAppRenameFlow({
    viewVisit,
    entryByPath: viewModel.entryByPath,
    indexMap: viewModel.indexMap,
    selected,
    viewParentPath: dataPipeline.viewParentPath,
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
    onAfterClearSelection: fileDrop.clearDragState,
    handleSelectItem,
    handleRenameCommit,
    tryStartBatchRename,
    setRenameTarget,
    setRenameValue,
  });

  const handleRenameSelection = useCallback((paths: string[]) => {
    const anchor = getSelectionTarget();
    const path = anchor && paths.includes(anchor.path) ? anchor.path : paths[0];
    const entry = viewModel.entryByPath.get(path);
    if (!entry) return false;
    handleRenameStart(entry);
    return true;
  }, [getSelectionTarget, handleRenameStart, viewModel.entryByPath]);

  const hasTransientDragUi = Boolean(
    fileDrop.dropTargetPath ||
      fileDrop.dropTargetTabId ||
      fileDrop.dragPoint ||
      fileDrop.tabDropSubmenu.hostTabId,
  );

  const handleCancelTransientUi = useCallback(() => {
    fileDrop.clearDragState();
  }, [fileDrop]);

  const { viewLoading, viewPath, sortState, activeSearch } = resolvedView;
  const { loadingPath, loadDir } = fileManager;
  const { handleRefresh } = navigationController;
  const handleManualRefresh = useCallback(() => {
    // A restored tab whose folder failed to open can retry its displayed path.
    if (viewLoading && !loadingPath && viewPath) {
      void loadDir(viewPath, { sort: sortState, search: activeSearch, force: true });
      return;
    }
    handleRefresh();
  }, [activeSearch, handleRefresh, loadDir, loadingPath, sortState, viewLoading, viewPath]);

  const { queueCreateSelection } = usePendingCreateSelection({
    viewKey: resolvedView.viewKey,
    viewPathKey: resolvedView.viewPathKey,
    viewLoading: resolvedView.viewLoading,
    indexMap: viewModel.indexMap,
    onSelectionChange: handleSelectionChange,
    onScrollToIndex: requestScrollToIndexForView,
  });

  const {
    handleCreateFile,
    handleCreateFolder,
    handleCreateFolderAndGo,
    handleOpenShell,
    handleOpenThumbCache,
    handleClearThumbCache,
  } = useAppCommands({
    viewVisit,
    browseFromView: viewState.browseFromView,
    queueCreateSelection,
    createFile: fileManager.createFile,
    createFolder: fileManager.createFolder,
    setThumbResetNonce,
  });

  const handleStartDragOut = useDragOutHandler({
    beginFileActivity: fileManager.beginFileActivity,
    viewParentPath: dataPipeline.viewParentPath,
    onRefresh: fileManager.refreshAfterChange,
  });
  const { refreshClipboardFromOs } = dataPipeline;
  const { refreshAfterChange } = fileManager;
  const onShellCommand = useCallback(() => {
    void refreshClipboardFromOs();
    if (viewVisit.current) void refreshAfterChange();
  }, [refreshAfterChange, refreshClipboardFromOs, viewVisit]);
  const menuServices: ContextMenuServices = {
    windowsMenuEnabled: tauriEnv,
    beginFileActivity: fileManager.beginFileActivity,
    shellAvailability: dataPipeline.shellAvailability,
    menuOpenPwsh: settings.menuOpenPwsh,
    menuOpenWsl: settings.menuOpenWsl,
    menuShowConvert: settings.menuShowConvert,
    onOpenShell: handleOpenShell,
    confirmDelete: settings.confirmDelete,
    onOpenConvertModal: dataPipeline.openConversionModal,
    onQuickConvertImages: dataPipeline.handleQuickConvertImages,
    places,
    onAddPlace: addPlace,
    onPinPlace: pinPlace,
    onUnpinPlace: unpinPlace,
    onRemovePlace: removePlace,
  };
  const {
    paneFileCommands,
    openKeyboardContextMenu,
    contextMenuItems,
    contextMenuOpen,
    handlePlaceTargetContextMenu,
    handlePlaceTargetContextMenuDown,
    handleLayoutContextMenu,
    handleLayoutContextMenuDown,
    handleEntryContextMenu,
    handleEntryContextMenuDown,
  } = useAppContextMenuSection({
    ...menuServices,
    onShellCommand,
    mainRef: viewState.mainRef,
    contextMenu: menuState.contextMenu,
    openContextMenuAt: menuState.openContextMenuAt,
    openSortMenu: menuState.openSortMenu,
    openEntryMenu: menuState.openEntryMenu,
    openPlaceTargetMenu: (event, target) => {
      const fromSidebar = target.source === "sidebar-place" || target.source === "sidebar-recent";
      const owner = fromSidebar && useBottomPaneStore.getState().active ? menuState.bottomMenu : menuState;
      owner.openPlaceTargetMenu(event, target);
    },
    closeContextMenu: menuState.closeContextMenu,
    selected,
    entryByPath: viewModel.entryByPath,
    onSelectionChange: handleSelectionChange,
    currentPath: resolvedView.viewLoading ? "" : resolvedView.viewPath,
    viewParentPath: dataPipeline.viewParentPath,
    sortState: resolvedView.sortState,
    onSortChange: navigationController.handleSortChange,
    onCreateFolder: handleCreateFolder,
    onCreateFolderAndGo: handleCreateFolderAndGo,
    onCreateFile: handleCreateFile,
    onOpenEntry: fileManager.openEntry,
    onOpenGallery: mainPreview.open,
    onOpenDir: viewState.browseFromView,
    onOpenDirNewTab: navigationController.handleOpenInNewTab,
    onOpenDirInBackgroundTab: tabSession.openInBackgroundTab,
    terminalTabs: tabSession,
    onDeleteEntries: fileManager.deleteEntries,
    onClearSelection: handleClearSelection,
    onRenameEntry: handleRenameStart,
    onPasteEntries: fileManager.pasteEntries,
    onCopyEntries: fileManager.copyEntries,
    onMoveEntries: fileManager.moveEntries,
    onCreateFolderWithSelection: async (paths, parent, name, onCreated) => {
      const created = await fileManager.createFolderWithSelection(paths, parent, name, onCreated);
      if (created && viewVisit.current) {
        tabSession.setSearch("");
        queueCreateSelection(created, parent);
      }
    },
    onRemoveRecentJump: tabSession.removeRecentJump,
  });

  return {
    viewModel,
    requestScrollToIndexForView,
    previewOpenRef,
    previewOpen,
    previewPath,
    previewMeta,
    previewGallery,
    bottomPreview,
    indexedSearch: {
      preview: indexedPreview,
      onOpenGallery: openPreview,
      menuActions: {
        windowsMenuEnabled: tauriEnv,
        beginFileActivity: fileManager.beginFileActivity,
        confirmDelete: settings.confirmDelete,
        menuShowConvert: settings.menuShowConvert,
        onShellCommand,
        onOpenFolder: tabSession.jumpTo,
        onOpenFolderNewTab: navigationController.handleOpenInNewTab,
        onRename: fileManager.renameEntry,
        onDeleteEntries: fileManager.deleteEntries,
        onPasteEntries: fileManager.pasteEntries,
        onMoveEntries: fileManager.moveEntries,
        onOpenConvertModal: dataPipeline.openConversionModal,
        onQuickConvertImages: dataPipeline.handleQuickConvertImages,
      },
    },
    handlePreviewPress: mainPreview.onPress,
    handlePreviewRelease,
    handlePreviewSelect,
    closePreviewIfOpen,
    gridColumnsRef,
    handleGridColumnsChange,
    selected,
    selectItem,
    selectionItems,
    getSelectionIndex,
    getSelectionTarget,
    renameTarget,
    renameValue,
    setRenameTarget,
    setRenameValue,
    handleRenameCommit,
    handleRenameCancel,
    handleSelectionChange,
    handleClearSelection,
    hasTransientDragUi,
    handleCancelTransientUi,
    handleSelectItemWithRename,
    handleManualRefresh,
    handleSelectAll,
    paneFileCommands,
    handleRenameSelection,
    handleCreateFile,
    handleCreateFolder,
    handleCreateFolderAndGo,
    handleOpenThumbCache,
    handleClearThumbCache,
    handleStartDragOut,
    openKeyboardContextMenu,
    contextMenuItems,
    contextMenuOpen,
    bottomMenu: {
      ...menuServices,
      ...menuState.bottomMenu,
      onOpenDirInMainPane: (path: string) => {
        navigationController.handleOpenInNewTab(path);
        viewState.mainRef.current?.focus({ preventScroll: true });
      },
    },
    handlePlaceTargetContextMenu,
    handlePlaceTargetContextMenuDown,
    handleLayoutContextMenu,
    handleLayoutContextMenuDown,
    handleEntryContextMenu,
    handleEntryContextMenuDown,
  };
};

export type ShellViewInteractionModel = ReturnType<typeof useShellViewInteractions>;
