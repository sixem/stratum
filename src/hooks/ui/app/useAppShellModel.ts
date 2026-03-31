// App shell model: gathers app-wide state slices so App.tsx can stay render-focused.
// The section-level hooks keep navigation, view orchestration, and overlays
// in dedicated files so this hook stays a thin assembler.
import { useEffect, useRef, useState } from "react";
import { useFileDrop, useFileManager } from "@/hooks/domain/filesystem";
import { useSettings, useTabSession } from "@/hooks/domain/session";
import { useWindowSize } from "@/hooks/perf/resize";
import { useScrollRequest } from "@/hooks/perf/scroll";
import { makeDebug } from "@/lib";
import { usePlacesStore, usePromptStore } from "@/modules";
import { useAppMenuState } from "./useAppMenuState";
import { useAppNavigationController } from "./useAppNavigationController";
import { useAppViewState } from "./useAppViewState";
import { resolveShellViewState } from "./layout/resolveShellViewState";
import { useShellNavigationModel } from "./layout/useShellNavigationModel";
import { useShellViewModel } from "./layout/useShellViewModel";
import { useShellOverlayModel } from "./overlays/useShellOverlayModel";

const viewLog = makeDebug("view");

const isTauriEnv = () => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

export const useAppShellModel = () => {
  // Core filesystem state is shared across every shell slice.
  const fileManager = useFileManager();
  const settings = useSettings();
  const tabSession = useTabSession({
    currentPath: fileManager.currentPath,
    loadDir: fileManager.loadDir,
    clearDir: fileManager.clearDir,
    defaultViewMode: settings.defaultViewMode,
    recentJumpsLimit: settings.sidebarRecentLimit,
  });
  const fileDrop = useFileDrop({
    currentPath: fileManager.currentPath,
    onRefresh: fileManager.refresh,
    enableTabDropSubfolders: settings.tabDropSubfolders,
  });
  const scrollState = useScrollRequest();
  const { flushPersist: flushWindowSize } = useWindowSize();
  const lastViewRef = useRef<{ tabId: string | null; pathKey: string } | null>(null);

  // Menu and overlay state stays local to the shell model so App only renders slices.
  const menuState = useAppMenuState();
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
  const reorderPinnedPlace = usePlacesStore((state) => state.reorderPinnedPlace);
  const removePlace = usePlacesStore((state) => state.removePlace);

  useEffect(() => {
    if (placesInitialized) return;
    if (!fileManager.placesLoaded) return;
    seedDefaultPlaces(fileManager.places);
  }, [fileManager.places, fileManager.placesLoaded, placesInitialized, seedDefaultPlaces]);

  const resolvedView = resolveShellViewState({
    fileManager,
    settings,
    tabSession,
    lastViewRef,
  });

  // View inputs stay grouped so the render tree only consumes already-derived data.
  const viewState = useAppViewState({
    currentPath: fileManager.currentPath,
    displayPath: resolvedView.viewPath,
    parentPath: resolvedView.viewParentPathBase,
    loading: resolvedView.viewLoading,
    jumpTo: tabSession.jumpTo,
    browseTo: tabSession.browseTo,
  });
  const navigationController = useAppNavigationController({
    activeTabId: resolvedView.activeTabId,
    activeTabPath: resolvedView.activeTabPath,
    currentPath: fileManager.currentPath,
    loading: fileManager.loading,
    activeSearch: resolvedView.activeSearch,
    mainRef: viewState.mainRef,
    refresh: fileManager.refresh,
    loadDir: fileManager.loadDir,
    jumpTo: tabSession.jumpTo,
    selectTab: tabSession.selectTab,
    closeTab: tabSession.closeTab,
    newTab: tabSession.newTab,
    openInNewTab: tabSession.openInNewTab,
    setSort: tabSession.setSort,
    setTabScrollTop: tabSession.setTabScrollTop,
    goBack: resolvedView.goBack,
    goForward: resolvedView.goForward,
    sidebarOpen: resolvedView.sidebarOpen,
    updateSettings: settings.updateSettings,
    setAboutOpen,
    browseFromView: viewState.browseFromView,
    viewPath: resolvedView.viewPath,
    crumbTrailPath: resolvedView.crumbTrailPath,
  });

  const shellView = useShellViewModel({
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
  });

  const navigation = useShellNavigationModel({
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
  });
  const overlays = useShellOverlayModel({
    tauriEnv,
    aboutOpen,
    menuState,
    navigationController,
    shellView,
  });

  return {
    navigation,
    view: shellView.view,
    selection: shellView.selection,
    preview: shellView.preview,
    overlays,
  };
};
