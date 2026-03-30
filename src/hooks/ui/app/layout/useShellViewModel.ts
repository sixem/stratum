// Coordinates the shell-view composition hooks.
// Each smaller hook owns one layer of responsibility so this file can stay as a
// readable map of how the app shell is assembled.
import { useShellFileViewAssembly } from "./useShellFileViewAssembly";
import type { UseShellViewModelOptions } from "./shellViewModel.types";
import { useShellViewBindings } from "./useShellViewBindings";
import { useShellViewDataPipeline } from "./useShellViewDataPipeline";
import { useShellViewInteractions } from "./useShellViewInteractions";

export const useShellViewModel = ({
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
}: UseShellViewModelOptions) => {
  const dataPipeline = useShellViewDataPipeline({
    tauriEnv,
    promptOpen,
    aboutOpen,
    menuState,
    fileManager,
    settings,
    viewState,
    thumbResetNonce,
    resolvedView,
  });

  const interactionModel = useShellViewInteractions({
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
  });

  useShellViewBindings({
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
  });

  return useShellFileViewAssembly({
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
  });
};
