// Owns selection, preview, rename, commands, and context-menu orchestration for
// the shell view. This hook intentionally works from the already-filtered data
// pipeline so interaction code can focus on user intent instead of source
// derivation.
import { useCallback } from "react";
import { useDragOutHandler } from "@/hooks/ui/inputs";
import { useFileViewInteractions, useFileViewModel } from "@/hooks/ui/view";
import { useAppCommands } from "../useAppCommands";
import { useAppContextMenuSection } from "../useAppContextMenuSection";
import { useAppPreviewSection } from "../useAppPreviewSection";
import { useAppRenameFlow } from "../useAppRenameFlow";
import { useAppSelectionHandlers } from "../useAppSelectionHandlers";
import { usePendingCreateSelection } from "../usePendingCreateSelection";
import type { UseShellViewModelOptions } from "./shellViewModel.types";
import type { ShellViewDataPipeline } from "./useShellViewDataPipeline";

type UseShellViewInteractionsOptions = Pick<
  UseShellViewModelOptions,
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
  const viewModel = useFileViewModel(
    dataPipeline.sortedEntries,
    dataPipeline.viewParentPath,
  );
  const requestScrollToIndexForView = useCallback(
    (index: number) => scrollState.requestScrollToIndex(index, resolvedView.viewKey),
    [resolvedView.viewKey, scrollState],
  );

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
    contextMenuOpen: dataPipeline.contextMenuActive,
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
    blockReveal: dataPipeline.blockReveal,
    loading: resolvedView.viewLoading,
    settingsOpen: menuState.settingsOpen,
    promptOpen,
    contextMenuOpen: dataPipeline.contextMenuActive,
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
    viewParentPath: dataPipeline.viewParentPath,
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
    viewParentPath: dataPipeline.viewParentPath,
    sortState: resolvedView.sortState,
    onSortChange: navigationController.handleSortChange,
    onPaste: (paths) => {
      void fileManager.pasteEntries(paths);
    },
    onCreateFolder: handleCreateFolder,
    onCreateFolderAndGo: handleCreateFolderAndGo,
    onCreateFile: handleCreateFile,
    shellAvailability: dataPipeline.shellAvailability,
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
    onOpenConvertModal: dataPipeline.openConversionModal,
    onQuickConvertImages: dataPipeline.handleQuickConvertImages,
    ffmpegDetected: dataPipeline.ffmpegDetected,
    places,
    onAddPlace: addPlace,
    onPinPlace: pinPlace,
    onUnpinPlace: unpinPlace,
    onRemovePlace: removePlace,
    onRemoveRecentJump: tabSession.removeRecentJump,
  });

  return {
    viewModel,
    requestScrollToIndexForView,
    previewOpenRef,
    previewOpen,
    previewPath,
    previewMeta,
    handlePreviewPress,
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
    handleSelectItemWithRename,
    handleManualRefresh,
    handleSelectAll,
    handleCreateFile,
    handleCreateFolder,
    handleCreateFolderAndGo,
    handleInternalDrop,
    handleInternalHover,
    handleOpenThumbCache,
    handleClearThumbCache,
    handleStartDragOut,
    contextMenuItems,
    contextMenuOpen,
    handlePlaceTargetContextMenu,
    handlePlaceTargetContextMenuDown,
    handleLayoutContextMenu,
    handleLayoutContextMenuDown,
    handleEntryContextMenu,
    handleEntryContextMenuDown,
  };
};

export type ShellViewInteractionModel = ReturnType<typeof useShellViewInteractions>;
