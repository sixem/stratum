// Thin assembly hook for app-shell side effects.
// Each focused effect composer owns one concern so App.tsx and shell wiring stay reusable.
import {
  useAppScrollEffects,
  useAppViewCleanupEffects,
  useAppWindowFocusEffects,
  useAppWindowTitleEffects,
} from "@/hooks/ui/app/effects";
import { useDirectoryFilter } from "@/hooks/domain/filesystem/useDirectoryFilter";
import {
  useAppAppearance,
  useCloseConfirm,
  useDirWatch,
  useSearchHotkey,
  useTransferProgress,
} from "@/hooks";
import type { UseAppEffectsOptions } from "@/hooks/ui/app/effects";

export const useAppEffects = ({
  isTauriEnv,
  appName,
  appVersion,
  refs,
  settings,
  view,
  actions,
  shouldResetScroll,
  viewLog,
}: UseAppEffectsOptions) => {
  const { searchInputRef, lastViewRef } = refs;
  const {
    confirmClose,
    accentTheme,
    darkMode,
    ambientBackground,
    blurOverlays,
    gridRounded,
    gridCentered,
  } = settings;
  const {
    activeTabId,
    activeTabPath,
    activeSearch,
    currentPath,
    viewPath,
    viewPathKey,
    viewMode,
    loading,
    sidebarOpen,
    deferredSearchValue,
    sortState,
    tabs,
    contextMenuOpen,
  } = view;
  const {
    clearSearchAndFocusView,
    closePreviewIfOpen,
    flushWindowSize,
    loadDir,
    requestEntryMeta,
    clearDir,
    setRenameTarget,
    setRenameValue,
    setTabScrollTop,
    stashActiveScroll,
    onPresenceToggle,
  } = actions;

  useSearchHotkey(searchInputRef, clearSearchAndFocusView);
  useCloseConfirm({
    enabled: isTauriEnv,
    confirmClose,
    onBeforeClose: flushWindowSize,
    onBeforePrompt: closePreviewIfOpen,
  });
  useTransferProgress({ enabled: isTauriEnv });
  useDirWatch({
    enabled: isTauriEnv,
    activeTabId,
    activeTabPath,
    currentPath,
    tabs,
    sortState,
    searchQuery: activeSearch,
    loadDir,
    requestEntryMeta,
    loading,
    onPresenceToggle,
  });
  useAppAppearance({
    accentTheme,
    darkMode,
    ambientBackground,
    blurOverlays,
    gridRounded,
    gridCentered,
  });

  useDirectoryFilter({
    activeTabPath,
    activeSearch,
    currentPath,
    deferredSearchValue,
    sortState,
    loading,
    loadDir,
  });

  useAppViewCleanupEffects({
    activeTabId,
    activeTabPath,
    currentPath,
    sidebarOpen,
    viewMode,
    contextMenuOpen,
    loading,
    clearDir,
    setRenameTarget,
    setRenameValue,
    viewLog,
  });

  useAppScrollEffects({
    lastViewRef,
    activeTabId,
    viewPathKey,
    shouldResetScroll,
    setTabScrollTop,
    stashActiveScroll,
  });

  useAppWindowTitleEffects({
    isTauriEnv,
    appName,
    appVersion,
    viewPath,
  });
  useAppWindowFocusEffects(isTauriEnv);
};
