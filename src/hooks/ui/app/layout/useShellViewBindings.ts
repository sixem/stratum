// Runs the shell-view side effects and shortcut bindings after the data and
// interaction models have already been composed. This keeps the coordinator
// focused on wiring, while the imperative bindings stay isolated in one file.
import { APP_NAME, APP_VERSION } from "@/constants";
import { useSelectionShortcuts } from "@/hooks/ui/selection";
import { useAppEffects } from "../useAppEffects";
import { useAppKeybinds } from "../useAppKeybinds";
import type { UseShellViewModelOptions } from "./shellViewModel.types";
import type { ShellViewDataPipeline } from "./useShellViewDataPipeline";
import type { ShellViewInteractionModel } from "./useShellViewInteractions";

type UseShellViewBindingsOptions = Pick<
  UseShellViewModelOptions,
  | "tauriEnv"
  | "promptOpen"
  | "menuState"
  | "fileManager"
  | "settings"
  | "tabSession"
  | "flushWindowSize"
  | "lastViewRef"
  | "setSuppressExternalPresence"
  | "resolvedView"
  | "viewState"
  | "navigationController"
  | "viewLog"
> & {
  dataPipeline: ShellViewDataPipeline;
  interactionModel: ShellViewInteractionModel;
};

export const useShellViewBindings = ({
  tauriEnv,
  promptOpen,
  menuState,
  fileManager,
  settings,
  tabSession,
  flushWindowSize,
  lastViewRef,
  setSuppressExternalPresence,
  resolvedView,
  viewState,
  navigationController,
  viewLog,
  dataPipeline,
  interactionModel,
}: UseShellViewBindingsOptions) => {
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
      contextMenuOpen: dataPipeline.contextMenuActive,
    },
    actions: {
      clearSearchAndFocusView: viewState.clearSearchAndFocusView,
      closePreviewIfOpen: interactionModel.closePreviewIfOpen,
      setSearchValue: viewState.setSearchValue,
      setTabSearch: tabSession.setSearch,
      flushWindowSize,
      loadDir: fileManager.loadDir,
      requestEntryMeta: fileManager.requestEntryMeta,
      clearDir: fileManager.clearDir,
      setRenameTarget: interactionModel.setRenameTarget,
      setRenameValue: interactionModel.setRenameValue,
      setTabScrollTop: tabSession.setTabScrollTop,
      stashActiveScroll: navigationController.stashActiveScroll,
      onPresenceToggle: setSuppressExternalPresence,
    },
    shouldResetScroll: resolvedView.shouldResetScroll,
    viewLog,
  });

  useSelectionShortcuts({
    blockReveal: dataPipeline.blockReveal,
    previewOpen: interactionModel.previewOpen,
    contextMenuOpen: dataPipeline.contextMenuActive,
    loading: resolvedView.viewLoading,
    settingsOpen: menuState.settingsOpen,
    smartTabBlocked: dataPipeline.smartTabBlocked,
    viewMode: resolvedView.viewMode,
    smartTabJump: settings.smartTabJump,
    mainRef: viewState.mainRef,
    gridColumnsRef: interactionModel.gridColumnsRef,
    selectionItems: interactionModel.selectionItems,
    getSelectionIndex: interactionModel.getSelectionIndex,
    selectItem: interactionModel.selectItem,
    requestScrollToIndex: interactionModel.requestScrollToIndexForView,
    getSelectionTarget: interactionModel.getSelectionTarget,
    onOpenDir: viewState.browseFromView,
    onOpenEntry: fileManager.openEntry,
  });

  useAppKeybinds({
    keybinds: settings.keybinds,
    confirmDelete: settings.confirmDelete,
    settingsOpen: menuState.settingsOpen,
    conversionModalOpen: dataPipeline.conversionModalOpen,
    contextMenuOpen: dataPipeline.contextMenuActive,
    promptOpen,
    previewOpen: interactionModel.previewOpen,
    blockReveal: dataPipeline.blockReveal,
    activeTabId: resolvedView.activeTabId,
    tabs: resolvedView.tabs,
    selected: interactionModel.selected,
    viewParentPath: dataPipeline.viewParentPath,
    canUndo: fileManager.canUndo,
    undo: fileManager.undo,
    deleteEntries: fileManager.deleteEntries,
    duplicateEntries: fileManager.duplicateEntries,
    pasteEntries: fileManager.pasteEntries,
    refreshClipboardFromOs: dataPipeline.refreshClipboardFromOs,
    onNewTab: navigationController.handleNewTab,
    onCloseTab: navigationController.handleCloseTab,
    onSelectTab: navigationController.handleSelectTab,
    onRefresh: interactionModel.handleManualRefresh,
    onClearSelection: interactionModel.handleClearSelection,
    hasTransientUi: interactionModel.hasTransientDragUi,
    onCancelTransientUi: interactionModel.handleCancelTransientUi,
    onSelectAll: interactionModel.handleSelectAll,
  });
};
