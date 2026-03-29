// Builds the overlay slice for the app shell.
// This keeps App.tsx and useAppShellModel focused on composition while the
// overlay prop translation stays close to the overlay helpers.
import { APP_DESCRIPTION, APP_NAME, APP_VERSION } from "@/constants";
import type { useAppMenuState } from "../useAppMenuState";
import type { useAppNavigationController } from "../useAppNavigationController";
import type { useShellViewModel } from "../layout/useShellViewModel";
import { useAppOverlaySection } from "../useAppOverlaySection";

type MenuStateModel = ReturnType<typeof useAppMenuState>;
type NavigationControllerModel = ReturnType<typeof useAppNavigationController>;
type ShellViewModel = ReturnType<typeof useShellViewModel>;

type UseShellOverlayModelOptions = {
  tauriEnv: boolean;
  aboutOpen: boolean;
  menuState: MenuStateModel;
  navigationController: NavigationControllerModel;
  shellView: ShellViewModel;
};

export const useShellOverlayModel = ({
  tauriEnv,
  aboutOpen,
  menuState,
  navigationController,
  shellView,
}: UseShellOverlayModelOptions) => {
  return useAppOverlaySection({
    appMeta: {
      isTauriEnv: tauriEnv,
      appName: APP_NAME,
      description: APP_DESCRIPTION,
      version: APP_VERSION,
    },
    about: {
      open: aboutOpen,
      onClose: navigationController.handleCloseAbout,
    },
    contextMenu: {
      state: menuState.contextMenu
        ? { x: menuState.contextMenu.x, y: menuState.contextMenu.y }
        : null,
      open: shellView.overlayContext.contextMenuOpen,
      items: shellView.overlayContext.contextMenuItems,
      onClose: menuState.closeContextMenu,
    },
    quickPreview: {
      open: shellView.overlayContext.previewOpen,
      path: shellView.overlayContext.previewPath,
      meta: shellView.overlayContext.previewMeta,
      items: shellView.overlayContext.sortedEntries,
      entryMeta: shellView.overlayContext.entryMeta,
      thumbnails: shellView.overlayContext.thumbnails,
      thumbnailsEnabled: shellView.overlayContext.thumbnailsEnabled,
      onRequestMeta: shellView.overlayContext.requestMeta,
      onRequestThumbs: shellView.overlayContext.requestThumbnails,
      thumbResetKey: shellView.overlayContext.thumbnailResetKey,
      loading: shellView.overlayContext.viewLoading,
      onSelectPreview: shellView.overlayContext.handlePreviewSelect,
      smartTabJump: shellView.overlayContext.smartTabJump,
      smartTabBlocked: shellView.overlayContext.smartTabBlocked,
    },
    settings: {
      open: menuState.settingsOpen,
      onClose: menuState.closeSettings,
      onOpenCacheLocation: shellView.overlayContext.handleOpenThumbCache,
      onClearCache: shellView.overlayContext.handleClearThumbCache,
    },
    conversion: {
      open: shellView.overlayContext.conversionModalState.open,
      request: shellView.overlayContext.conversionModalState.request,
      draft: shellView.overlayContext.conversionModalState.uiDraft,
      runState: shellView.overlayContext.conversionModalState.run,
      onDraftChange: shellView.overlayContext.handleConversionDraftChange,
      onConvert: shellView.overlayContext.handleStartConversion,
      onClose: shellView.overlayContext.closeConversionModal,
    },
  });
};
