// Translates the shell data + interaction models into the render-facing slices
// consumed by AppContent, status UI, and overlay builders.
import { useStatusLabels } from "@/hooks/domain/metadata";
import { useAppFileViewController } from "../useAppFileViewController";
import type { UseShellViewModelOptions } from "./shellViewModel.types";
import type { ShellViewDataPipeline } from "./useShellViewDataPipeline";
import type { ShellViewInteractionModel } from "./useShellViewInteractions";

type UseShellFileViewAssemblyOptions = Pick<
  UseShellViewModelOptions,
  | "fileManager"
  | "settings"
  | "tabSession"
  | "fileDrop"
  | "scrollState"
  | "resolvedView"
  | "viewState"
  | "navigationController"
  | "places"
> & {
  dataPipeline: ShellViewDataPipeline;
  interactionModel: ShellViewInteractionModel;
};

export const useShellFileViewAssembly = ({
  fileManager,
  settings,
  tabSession,
  fileDrop,
  scrollState,
  resolvedView,
  viewState,
  navigationController,
  places,
  dataPipeline,
  interactionModel,
}: UseShellFileViewAssemblyOptions) => {
  const { countLabel, selectionLabel } = useStatusLabels({
    isFiltered: dataPipeline.isFiltered,
    visibleCount: dataPipeline.visibleCount,
    totalCount: dataPipeline.resolvedTotalCount,
    currentDriveInfo: dataPipeline.currentDriveInfo,
    selected: interactionModel.selected,
    entryMeta: fileManager.entryMeta,
  });

  const { fileViewProps, layoutClass, layoutContextMenu, layoutContextMenuDown } =
    useAppFileViewController({
      sidebarOpen: resolvedView.sidebarOpen,
      showLander: resolvedView.showLander,
      showEmptyFolder: dataPipeline.showEmptyFolder,
      onLayoutContextMenu: interactionModel.handleLayoutContextMenu,
      onLayoutContextMenuDown: interactionModel.handleLayoutContextMenuDown,
      fileViewOptions: {
        view: {
          currentPath: resolvedView.viewPath,
          viewMode: resolvedView.viewMode,
          entries: dataPipeline.sortedEntries,
          items: interactionModel.viewModel.items,
          indexMap: interactionModel.viewModel.indexMap,
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
          selectedPaths: interactionModel.selected,
          onSetSelection: interactionModel.handleSelectionChange,
          onSelectItem: interactionModel.handleSelectItemWithRename,
          onClearSelection: interactionModel.handleClearSelection,
        },
        creation: {
          onCreateFolder: interactionModel.handleCreateFolder,
          onCreateFolderAndGo: interactionModel.handleCreateFolderAndGo,
          onCreateFile: interactionModel.handleCreateFile,
        },
        rename: {
          renameTargetPath: interactionModel.renameTarget?.path ?? null,
          renameValue: interactionModel.renameValue,
          onRenameChange: interactionModel.setRenameValue,
          onRenameCommit: interactionModel.handleRenameCommit,
          onRenameCancel: interactionModel.handleRenameCancel,
        },
        metadata: {
          entryMeta: fileManager.entryMeta,
          onRequestMeta: fileManager.requestEntryMeta,
        },
        thumbnails: {
          thumbnailsEnabled: settings.thumbnailsEnabled,
          thumbnails: dataPipeline.thumbnails,
          onRequestThumbs: dataPipeline.requestThumbnails,
          thumbnailFit: settings.thumbnailFit,
          thumbnailAppIcons: settings.thumbnailAppIcons,
          thumbnailFolders: settings.thumbnailFolders,
          thumbnailVideos: settings.thumbnailVideos,
          thumbnailSvgs: settings.thumbnailSvgs,
          categoryTinting: settings.categoryTinting,
          thumbResetKey: dataPipeline.thumbnailResetKey,
          presenceEnabled: dataPipeline.presenceEnabled,
        },
        grid: {
          gridSize: settings.gridSize,
          gridAutoColumns: settings.gridAutoColumns,
          gridGap: settings.gridGap,
          gridShowSize: settings.gridShowSize,
          gridShowExtension: settings.gridShowExtension,
          gridNameEllipsis: settings.gridNameEllipsis,
          gridNameHideExtension: settings.gridNameHideExtension,
          onGridColumnsChange: interactionModel.handleGridColumnsChange,
        },
        contextMenu: {
          onContextMenu: interactionModel.handleLayoutContextMenu,
          onContextMenuDown: interactionModel.handleLayoutContextMenuDown,
          onEntryContextMenu: interactionModel.handleEntryContextMenu,
          onEntryContextMenuDown: interactionModel.handleEntryContextMenuDown,
        },
        dragDrop: {
          dropTargetPath: fileDrop.dropTargetPath,
          onStartDragOut: interactionModel.handleStartDragOut,
          onInternalDrop: interactionModel.handleInternalDrop,
          onInternalHover: interactionModel.handleInternalHover,
        },
        preview: {
          onEntryPreviewPress: interactionModel.handlePreviewPress,
          onEntryPreviewRelease: interactionModel.handlePreviewRelease,
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
      open: interactionModel.previewOpen,
    },
    navigationContext: {
      handleManualRefresh: interactionModel.handleManualRefresh,
      handlePlaceTargetContextMenu: interactionModel.handlePlaceTargetContextMenu,
      handlePlaceTargetContextMenuDown: interactionModel.handlePlaceTargetContextMenuDown,
    },
    overlayContext: {
      contextMenuItems: interactionModel.contextMenuItems,
      contextMenuOpen: interactionModel.contextMenuOpen,
      previewOpen: interactionModel.previewOpen,
      previewPath: interactionModel.previewPath,
      previewMeta: interactionModel.previewMeta,
      sortedEntries: dataPipeline.sortedEntries,
      entryMeta: fileManager.entryMeta,
      thumbnailsEnabled: settings.thumbnailsEnabled,
      requestMeta: fileManager.requestEntryMeta,
      thumbnails: dataPipeline.thumbnails,
      requestThumbnails: dataPipeline.requestThumbnails,
      thumbnailResetKey: dataPipeline.thumbnailResetKey,
      viewLoading: resolvedView.viewLoading,
      handlePreviewSelect: interactionModel.handlePreviewSelect,
      smartTabJump: settings.smartTabJump,
      smartTabBlocked: dataPipeline.smartTabBlocked,
      handleOpenThumbCache: interactionModel.handleOpenThumbCache,
      handleClearThumbCache: interactionModel.handleClearThumbCache,
      conversionModalState: dataPipeline.conversionModalState,
      handleConversionDraftChange: dataPipeline.handleConversionDraftChange,
      handleStartConversion: dataPipeline.handleStartConversion,
      closeConversionModal: dataPipeline.closeConversionModal,
    },
  };
};
