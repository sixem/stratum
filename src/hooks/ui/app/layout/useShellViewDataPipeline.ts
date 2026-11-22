// Owns the thumbnail, metadata, shell-capability, and conversion pipelines for
// the shell view. Keeping these derivations together makes the later
// interaction hooks work with already-shaped data instead of raw filesystem
// state.
import { useMemo } from "react";
import {
  useClipboardSync,
  useDriveInfo,
  useShellAvailability,
} from "@/hooks/domain/filesystem";
import {
  useFilteredEntries,
  useMetaPrefetch,
  useThumbnails,
} from "@/hooks/domain/metadata";
import { useConversionController } from "../useConversionController";
import type { UseShellViewModelOptions } from "./shellViewModel.types";

type UseShellViewDataPipelineOptions = Pick<
  UseShellViewModelOptions,
  | "tauriEnv"
  | "promptOpen"
  | "aboutOpen"
  | "menuState"
  | "fileManager"
  | "settings"
  | "viewState"
  | "thumbResetNonce"
>;

type UseShellViewDataPipelineResolvedView = Pick<
  UseShellViewModelOptions["resolvedView"],
  | "viewLoading"
  | "showLander"
  | "viewEntries"
  | "displaySearch"
  | "viewTotalCount"
  | "viewParentPathBase"
  | "canGoUp"
  | "viewPathKey"
  | "sortState"
>;

export const useShellViewDataPipeline = ({
  tauriEnv,
  promptOpen,
  aboutOpen,
  menuState,
  fileManager,
  settings,
  viewState,
  thumbResetNonce,
  resolvedView,
}: UseShellViewDataPipelineOptions & {
  resolvedView: UseShellViewDataPipelineResolvedView;
}) => {
  const { contextMenuActive } = menuState;
  const blockReveal = resolvedView.viewLoading;
  const darkSvgPreviews = settings.darkMode && settings.thumbnailSvgs;

  const thumbnailOptions = useMemo(
    () => ({
      size: settings.thumbnailSize,
      quality: settings.thumbnailQuality,
      format: settings.thumbnailFormat,
      allowVideos: settings.thumbnailVideos,
      allowSvgs: settings.thumbnailSvgs,
      darkSvgPreviews,
      cacheMb: settings.thumbnailCacheMb,
    }),
    [
      darkSvgPreviews,
      settings.thumbnailCacheMb,
      settings.thumbnailFormat,
      settings.thumbnailQuality,
      settings.thumbnailSize,
      settings.thumbnailSvgs,
      settings.thumbnailVideos,
    ],
  );
  const thumbnailCacheResetKey = `reset:${thumbResetNonce}`;
  const { thumbnails, requestThumbnails, optionsKey } = useThumbnails(
    thumbnailOptions,
    settings.thumbnailsEnabled,
    thumbnailCacheResetKey,
  );
  const thumbnailResetKey = `${thumbnailCacheResetKey}:${optionsKey}`;

  const { sortedEntries, visibleCount, isFiltered, totalCount: resolvedTotalCount } =
    useFilteredEntries({
      entries: resolvedView.viewEntries,
      searchValue: viewState.deferredSearchValue,
      totalCount: resolvedView.viewTotalCount,
    });

  const showEmptyFolder =
    !resolvedView.showLander &&
    !resolvedView.viewLoading &&
    resolvedView.viewEntries.length === 0 &&
    viewState.deferredSearchValue.trim().length === 0;
  const viewParentPath =
    resolvedView.viewParentPathBase &&
    resolvedView.canGoUp &&
    settings.showParentEntry &&
    !resolvedView.displaySearch.trim() &&
    !showEmptyFolder
      ? resolvedView.viewParentPathBase
      : null;

  const metaPrefetchKey = `${resolvedView.viewPathKey}:${resolvedView.sortState.key}:${resolvedView.sortState.dir}:${viewState.deferredSearchValue}`;
  useMetaPrefetch({
    enabled: resolvedView.sortState.key !== "name",
    loading: resolvedView.viewLoading,
    resetKey: metaPrefetchKey,
    entries: sortedEntries,
    entryMeta: fileManager.entryMeta,
    requestMeta: fileManager.requestEntryMeta,
    // Defer non-visible updates so scrolling stays responsive.
    deferUpdates: true,
    flushMeta: fileManager.flushEntryMeta,
  });

  const { currentDriveInfo } = useDriveInfo({
    currentPath: fileManager.currentPath,
    drives: fileManager.drives,
    driveInfo: fileManager.driveInfo,
  });
  const { refreshFromOs: refreshClipboardFromOs } = useClipboardSync({
    enabled: tauriEnv,
    contextMenuOpen: contextMenuActive,
  });
  const shellAvailability = useShellAvailability({
    enabled: tauriEnv, ffmpegPath: settings.ffmpegPath, settingsOpen: menuState.settingsOpen,
  });

  const {
    conversionModalOpen,
    conversionModalState,
    openConversionModal,
    closeConversionModal,
    handleConversionDraftChange,
    handleStartConversion,
    handleQuickConvertImages,
  } = useConversionController({
    refreshEntries: fileManager.refresh,
    ffmpegPath: settings.ffmpegPath,
  });

  const smartTabBlocked =
    promptOpen ||
    menuState.settingsOpen ||
    aboutOpen ||
    conversionModalOpen ||
    contextMenuActive;

  return {
    blockReveal,
    contextMenuActive,
    thumbnailResetKey,
    thumbnails,
    requestThumbnails,
    sortedEntries,
    visibleCount,
    isFiltered,
    resolvedTotalCount,
    viewParentPath,
    currentDriveInfo,
    refreshClipboardFromOs,
    shellAvailability,
    conversionModalOpen,
    conversionModalState,
    openConversionModal,
    closeConversionModal,
    handleConversionDraftChange,
    handleStartConversion,
    handleQuickConvertImages,
    smartTabBlocked,
    // Presence animations are currently disabled at the shell level to keep
    // selection and virtualization behavior deterministic.
    presenceEnabled: false,
  };
};

export type ShellViewDataPipeline = ReturnType<typeof useShellViewDataPipeline>;
