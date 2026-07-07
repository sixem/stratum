// App shell model: gathers app-wide state slices so App.tsx can stay render-focused.
// The section-level hooks keep navigation, view orchestration, and overlays
// in dedicated files so this hook stays a thin assembler.
import { useEffect, useRef, useState } from "react";
import { getIndexingLaunchPreferences, setIndexedSearchEnabled, setIndexingLaunchPreferences } from "@/api";
import { useFileDrop, useFileManager } from "@/hooks/domain/filesystem";
import { useSettings, useTabSession } from "@/hooks/domain/session";
import { useWindowSize } from "@/hooks/perf/resize";
import { useScrollRequest } from "@/hooks/perf/scroll";
import { makeDebug } from "@/lib";
import { useIndexedSearchUiStore, usePlacesStore, usePromptStore } from "@/modules";
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
    onRecordMoveUndo: fileManager.recordMoveUndo,
    onTransferInFlightChange: fileManager.setTransferInFlight,
    enableTabDropSubfolders: settings.tabDropSubfolders,
  });
  const scrollState = useScrollRequest();
  const { flushPersist: flushWindowSize } = useWindowSize();
  const lastViewRef = useRef<{ tabId: string | null; pathKey: string } | null>(null);
  const launchPreferencesHydratedRef = useRef(false);

  // Menu and overlay state stays local to the shell model so App only renders slices.
  const menuState = useAppMenuState();
  const tauriEnv = isTauriEnv();
  const promptOpen = usePromptStore((state) => Boolean(state.prompt));
  const [, setSuppressExternalPresence] = useState(false);
  const [thumbResetNonce, setThumbResetNonce] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [launchPreferencesReady, setLaunchPreferencesReady] = useState(!tauriEnv);
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

  useEffect(() => {
    if (!launchPreferencesReady) return;
    if (!tauriEnv) return;
    if (!settings.indexedSearchEnabled) {
      useIndexedSearchUiStore.getState().closeModal();
    }

    let canceled = false;

    const syncIndexedSearchState = async () => {
      await setIndexedSearchEnabled(settings.indexedSearchEnabled);
      await setIndexingLaunchPreferences({
        indexedSearchEnabled: settings.indexedSearchEnabled,
        acceleratedNtfsIndexing: settings.acceleratedNtfsIndexing,
      });
      if (canceled) return;
      await fileManager.refreshDriveInfo();
    };

    void syncIndexedSearchState();

    return () => {
      canceled = true;
    };
  }, [
    fileManager.refreshDriveInfo,
    launchPreferencesReady,
    settings.acceleratedNtfsIndexing,
    settings.indexedSearchEnabled,
    tauriEnv,
  ]);

  useEffect(() => {
    if (!tauriEnv) return;
    if (launchPreferencesHydratedRef.current) {
      setLaunchPreferencesReady(true);
      return;
    }
    let canceled = false;

    const reconcileLaunchPreferences = async () => {
      const launchPreferences = await getIndexingLaunchPreferences();
      if (canceled) return;

      if (
        launchPreferences.indexedSearchEnabled === settings.indexedSearchEnabled &&
        launchPreferences.acceleratedNtfsIndexing === settings.acceleratedNtfsIndexing
      ) {
        return;
      }

      settings.updateSettings({
        indexedSearchEnabled: launchPreferences.indexedSearchEnabled,
        acceleratedNtfsIndexing: launchPreferences.acceleratedNtfsIndexing,
      });
    };

    void reconcileLaunchPreferences().finally(() => {
      if (!canceled) {
        launchPreferencesHydratedRef.current = true;
        setLaunchPreferencesReady(true);
      }
    });

    return () => {
      canceled = true;
    };
  }, [settings.updateSettings, tauriEnv]);

  useEffect(() => {
    useIndexedSearchUiStore.getState().setOpenFolderInApp(tabSession.jumpTo);
    return () => {
      useIndexedSearchUiStore.getState().setOpenFolderInApp(null);
    };
  }, [tabSession.jumpTo]);

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
