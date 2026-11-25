// Builds the navigation slice for the app shell.
// The heavy interaction logic lives elsewhere; this hook assembles the
// topstack and sidebar props into the shape App.tsx renders.
import { useCallback } from "react";
import { APP_NAME } from "@/constants";
import { setBottomPaneActive } from "@/modules/bottomPaneStore";
import type { Place, TransferDestination } from "@/types";
import type { useFileDrop, useFileManager } from "@/hooks/domain/filesystem";
import type { useSettings, useTabSession } from "@/hooks/domain/session";
import { useTabHistoryMenu } from "../../menus/useTabHistoryMenu";
import type { useAppMenuState } from "../useAppMenuState";
import type { useAppNavigationController } from "../useAppNavigationController";
import type { useAppViewState } from "../useAppViewState";
import type { useShellViewModel } from "./useShellViewModel";
import { useAppTopstackProps } from "../useAppTopstackProps";
import { resolveShellViewState } from "./resolveShellViewState";

type FileManagerModel = ReturnType<typeof useFileManager>;
type SettingsModel = ReturnType<typeof useSettings>;
type TabSessionModel = ReturnType<typeof useTabSession>;
type FileDropModel = ReturnType<typeof useFileDrop>;
type MenuStateModel = ReturnType<typeof useAppMenuState>;
type NavigationControllerModel = ReturnType<typeof useAppNavigationController>;
type ViewStateModel = ReturnType<typeof useAppViewState>;
type ShellViewModel = ReturnType<typeof useShellViewModel>;
type ResolvedViewState = ReturnType<typeof resolveShellViewState>;

type UseShellNavigationModelOptions = {
  fileManager: FileManagerModel;
  settings: SettingsModel;
  tabSession: TabSessionModel;
  fileDrop: FileDropModel;
  menuState: MenuStateModel;
  resolvedView: ResolvedViewState;
  viewState: ViewStateModel;
  navigationController: NavigationControllerModel;
  shellView: ShellViewModel;
  places: Place[];
  reorderPinnedPlace: (fromPath: string, toPath: string, position: "before" | "after") => void;
};

export const useShellNavigationModel = ({
  fileManager,
  settings,
  tabSession,
  fileDrop,
  menuState,
  resolvedView,
  viewState,
  navigationController,
  shellView,
  places,
  reorderPinnedPlace,
}: UseShellNavigationModelOptions) => {
  const handleOpenRecycleBin = useCallback(() => {
    // The promise tracks the shell request. Explorer loads the view separately.
    return fileManager.openEntry("shell:RecycleBinFolder");
  }, [fileManager.openEntry]);
  const handleOpenJobDestination = ({ folderPath, entryPath }: TransferDestination) => {
    setBottomPaneActive(false);
    viewState.mainRef.current?.focus({ preventScroll: true });
    navigationController.handleOpenInNewTab(folderPath, { revealPath: entryPath });
  };
  const handleHistoryMenu = useTabHistoryMenu(tabSession, menuState.openActionMenu);

  const topstackProps = useAppTopstackProps({
    appName: APP_NAME,
    pathBar: {
      onBack: navigationController.handleBack,
      onForward: navigationController.handleForward,
      onHistoryMenu: handleHistoryMenu,
      onUp: viewState.handleUp,
      onDown: navigationController.handleDown,
      canGoBack: resolvedView.canGoBack,
      canGoForward: resolvedView.canGoForward,
      canGoUp: resolvedView.canGoUp,
      canGoDown: navigationController.canGoDown,
      showFolderChevrons: settings.showTopbarFolderChevrons,
    },
    pathInputsBar: {
      path: viewState.pathValue,
      search: tabSession.searchValue,
      indexedSearchEnabled: settings.indexedSearchEnabled,
      onPathChange: viewState.setPathValue,
      onSearchChange: tabSession.setSearch,
      onSubmit: viewState.handleGo,
      onRefresh: shellView.navigationContext.handleManualRefresh,
      loading: fileManager.loading,
      searchInputRef: viewState.searchInputRef,
    },
    tabsBar: {
      tabs: tabSession.tabs,
      activeId: resolvedView.activeTabId,
      dropTargetId: fileDrop.dropTargetTabId,
      dropTargetPath: fileDrop.dropTargetPath,
      tabDropSubmenu: fileDrop.tabDropSubmenu,
      dragPoint: fileDrop.dragPoint,
      onSelect: navigationController.handleSelectTab,
      onClose: navigationController.handleCloseTab,
      onNew: navigationController.handleNewTab,
      onNewPowerShell: () => {
        navigationController.stashActiveScroll();
        setBottomPaneActive(false);
        tabSession.newPowerShellTab();
      },
      onOpenLocation: (path) => {
        setBottomPaneActive(false);
        viewState.mainRef.current?.focus({ preventScroll: true });
        navigationController.handleOpenInNewTab(path);
      },
      onReorder: tabSession.reorderTabs,
      onMoveTab: (id, receive) => {
        if (tabSession.activeTabId === id) navigationController.stashActiveScroll();
        tabSession.moveTab(id, receive);
      },
      onReceiveTab: (transfer, index) => {
        navigationController.stashActiveScroll();
        if (!tabSession.receiveTab(transfer, index)) return false;
        setBottomPaneActive(false);
        viewState.mainRef.current?.focus({ preventScroll: true });
        return true;
      },
      onSubmenuHoverTargetChange: fileDrop.setDropTarget,
      onSubmenuCloseRequest: fileDrop.clearDragState,
      showTabNumbers: settings.showTabNumbers,
      fixedWidthTabs: settings.fixedWidthTabs,
      onStripContextMenu: menuState.openActionMenu,
      onTabContextMenu: shellView.navigationContext.handlePlaceTargetContextMenu,
      onTabContextMenuDown: shellView.navigationContext.handlePlaceTargetContextMenuDown,
    },
    crumbsBar: {
      path: resolvedView.viewPath,
      trailPath: resolvedView.crumbTrailPath,
      dropTargetPath: fileDrop.hoveredPane === "bottom" ? null : fileDrop.dropTargetPath,
      onNavigate: viewState.browseFromView,
      onNavigateNewTab: navigationController.handleOpenInNewTab,
      onCrumbContextMenu: shellView.navigationContext.handlePlaceTargetContextMenu,
      onCrumbContextMenuDown: shellView.navigationContext.handlePlaceTargetContextMenuDown,
    },
    sidebarOpen: resolvedView.sidebarOpen,
    onToggleSidebar: navigationController.handleToggleSidebar,
    onOpenAbout: navigationController.handleOpenAbout,
    drivePicker: settings.showDriveToggle ? {
      activePath: resolvedView.viewPath,
      drives: fileManager.drives,
      drivesLoading: !fileManager.drivesLoaded,
      driveInfo: fileManager.driveInfo,
      indexedSearchState: fileManager.indexedSearchStatus?.state,
      collapseOnBlur: settings.collapseDrivePickerOnBlur,
      onSelect: navigationController.handleSelectDrive,
      onSelectNewTab: navigationController.handleOpenInNewTab,
    } : undefined,
    pathBarActions: {
      viewMode: resolvedView.viewMode,
      settingsOpen: menuState.settingsOpen,
      showRecycleBinButton: settings.showRecycleBinButton,
      onViewChange: tabSession.setViewMode,
      onToggleSettings: menuState.toggleSettings,
      onOpenRecycleBin: handleOpenRecycleBin,
      onOpenJobDestination: handleOpenJobDestination,
    },
  });

  return {
    sidebarOpen: resolvedView.sidebarOpen,
    topstackProps,
    sidebarProps: {
      places,
      recentJumps: tabSession.recentJumps,
      activePath: resolvedView.viewPath,
      dropTargetPath: fileDrop.dropTargetPath,
      sectionOrder: settings.sidebarSectionOrder,
      hiddenSections: settings.sidebarHiddenSections,
      onSelect: navigationController.handleSelectPlace,
      onSelectRecent: tabSession.jumpTo,
      onSelectNewTab: navigationController.handleOpenInNewTab,
      onReorderPinnedPlace: reorderPinnedPlace,
      onPlaceContextMenu: shellView.navigationContext.handlePlaceTargetContextMenu,
      onPlaceContextMenuDown: shellView.navigationContext.handlePlaceTargetContextMenuDown,
      onRecentContextMenu: shellView.navigationContext.handlePlaceTargetContextMenu,
      onRecentContextMenuDown: shellView.navigationContext.handlePlaceTargetContextMenuDown,
      onOpenTipsMenu: menuState.openActionMenu,
    },
  };
};
