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
  const contextMenuActive = Boolean(menuState.contextMenu);
  const blockReveal = resolvedView.viewLoading;

  const thumbnailOptions = useMemo(
    () => ({
      size: settings.thumbnailSize,
      quality: settings.thumbnailQuality,
      format: settings.thumbnailFormat,
      allowVideos: settings.thumbnailVideos,
      allowSvgs: settings.thumbnailSvgs,
      cacheMb: settings.thumbnailCacheMb,
    }),
    [
      settings.thumbnailCacheMb,
      settings.thumbnailFormat,
      settings.thumbnailQuality,
      settings.thumbnailSize,
      settings.thumbnailSvgs,
      settings.thumbnailVideos,
    ],
  );
  const thumbnailResetKey = `reset:${thumbResetNonce}`;
  const { thumbnails, requestThumbnails } = useThumbnails(
    thumbnailOptions,
    settings.thumbnailsEnabled,
    thumbnailResetKey,
  );

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
    !isFiltered &&
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
  const shellAvailability = useShellAvailability({ enabled: tauriEnv });
  const ffmpegDetected =
    Boolean(shellAvailability?.ffmpeg) || settings.ffmpegPath.trim().length > 0;

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
    showEmptyFolder,
    viewParentPath,
    currentDriveInfo,
    refreshClipboardFromOs,
    shellAvailability,
    ffmpegDetected,
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
