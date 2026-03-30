// Builds the navigation slice for the app shell.
// The heavy interaction logic lives elsewhere; this hook assembles the
// topstack and sidebar props into the shape App.tsx renders.
import { useCallback } from "react";
import { APP_NAME } from "@/constants";
import type { Place } from "@/types";
import type { useFileDrop, useFileManager } from "@/hooks/domain/filesystem";
import type { useSettings, useTabSession } from "@/hooks/domain/session";
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
    // Windows shell namespace target for the system Recycle Bin.
    void fileManager.openEntry("shell:RecycleBinFolder");
  }, [fileManager.openEntry]);

  const topstackProps = useAppTopstackProps({
    appName: APP_NAME,
    pathBar: {
      onBack: navigationController.handleBack,
      onForward: navigationController.handleForward,
      onUp: viewState.handleUp,
      onDown: navigationController.handleDown,
      canGoBack: resolvedView.canGoBack,
      canGoForward: resolvedView.canGoForward,
      canGoUp: resolvedView.canGoUp,
      canGoDown: navigationController.canGoDown,
      loading: fileManager.loading,
    },
    pathInputsBar: {
      path: viewState.pathValue,
      search: viewState.searchValue,
      onPathChange: viewState.setPathValue,
      onSearchChange: viewState.setSearchValue,
      onSubmit: viewState.handleGo,
      onRefresh: shellView.navigationContext.handleManualRefresh,
      loading: fileManager.loading,
      searchInputRef: viewState.searchInputRef,
    },
    tabsBar: {
      tabs: tabSession.tabs,
      activeId: resolvedView.activeTabId,
      dropTargetId: fileDrop.dropTargetTabId,
      onSelect: navigationController.handleSelectTab,
      onClose: navigationController.handleCloseTab,
      onNew: navigationController.handleNewTab,
      onReorder: tabSession.reorderTabs,
      showTabNumbers: settings.showTabNumbers,
      fixedWidthTabs: settings.fixedWidthTabs,
      onTabContextMenu: shellView.navigationContext.handlePlaceTargetContextMenu,
      onTabContextMenuDown: shellView.navigationContext.handlePlaceTargetContextMenuDown,
    },
    crumbsBar: {
      path: resolvedView.viewPath,
      trailPath: resolvedView.crumbTrailPath,
      dropTargetPath: fileDrop.dropTargetPath,
      onNavigate: viewState.browseFromView,
      onNavigateNewTab: navigationController.handleOpenInNewTab,
      onCrumbContextMenu: shellView.navigationContext.handlePlaceTargetContextMenu,
      onCrumbContextMenuDown: shellView.navigationContext.handlePlaceTargetContextMenuDown,
    },
    sidebarOpen: resolvedView.sidebarOpen,
    onToggleSidebar: navigationController.handleToggleSidebar,
    onOpenAbout: navigationController.handleOpenAbout,
    drivePicker: {
      activePath: resolvedView.viewPath,
      drives: fileManager.drives,
      driveInfo: fileManager.driveInfo,
      onSelect: navigationController.handleSelectDrive,
      onSelectNewTab: navigationController.handleOpenInNewTab,
    },
    pathBarActions: {
      viewMode: resolvedView.viewMode,
      settingsOpen: menuState.settingsOpen,
      showRecycleBinButton: settings.showRecycleBinButton,
      onViewChange: tabSession.setViewMode,
      onToggleSettings: menuState.toggleSettings,
      onOpenRecycleBin: handleOpenRecycleBin,
    },
  });

  return {
    sidebarOpen: resolvedView.sidebarOpen,
    topstackProps,
    sidebarProps: {
      places,
      recentJumps: tabSession.recentJumps,
      activePath: fileManager.currentPath,
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
    },
  };
};
