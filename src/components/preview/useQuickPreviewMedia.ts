// Composes the focused quick preview hooks into the public preview model used
// by the overlay. The heavy state logic lives in smaller hooks and a pure
// derived-state builder.
import { useMemo } from "react";
import { getFileKind, getPathName } from "@/lib";
import type { EntryMeta } from "@/types";
import type { RefObject } from "react";
import { buildQuickPreviewDerivedState } from "./quickPreviewDerivedState";
import { usePreviewMediaLifecycle } from "./usePreviewMediaLifecycle";
import { usePreviewSource } from "./usePreviewSource";
import { usePreviewVolumeController } from "./usePreviewVolumeController";

type UseQuickPreviewMediaOptions = {
  open: boolean;
  path: string | null;
  meta?: EntryMeta | null;
  thumbnails: Map<string, string>;
  zoom: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  resetViewport: () => void;
  fitMediaToViewport: (width: number, height: number) => void;
};

const isTauriEnv = () => "__TAURI_INTERNALS__" in globalThis || "__TAURI__" in globalThis;

export const useQuickPreviewMedia = ({
  open,
  path,
  meta,
  thumbnails,
  zoom,
  videoRef,
  resetViewport,
  fitMediaToViewport,
}: UseQuickPreviewMediaOptions) => {
  const previewSessionKey = open ? `open:${path ?? ""}` : "closed";
  const { src, failed: sourceFailed } = usePreviewSource(open ? path : null);
  const isVideo = useMemo(() => {
    if (!open || !path) return false;
    return getFileKind(getPathName(path)) === "video";
  }, [open, path]);

  const volume = usePreviewVolumeController({ previewSessionKey });
  const canUseExternalActions = isTauriEnv();
  const lifecycle = usePreviewMediaLifecycle({
    open,
    path,
    src,
    isVideo,
    previewSessionKey,
    videoRef,
    resetViewport,
    fitMediaToViewport,
    videoVolume: volume.videoVolume,
    canUseExternalActions,
  });
  const loadState = sourceFailed ? "error" : src ? lifecycle.loadState : "loading";

  const derivedState = useMemo(
    () =>
      buildQuickPreviewDerivedState({
        open,
        path,
        src,
        isVideo,
        meta,
        thumbnails,
        zoom,
        loadState,
        loadedSrc: lifecycle.loadedSrc,
        mediaSize: lifecycle.mediaSize,
        videoVolume: volume.videoVolume,
        canUseExternalActions,
      }),
    [
      canUseExternalActions,
      isVideo,
      lifecycle.loadedSrc,
      lifecycle.mediaSize,
      loadState,
      meta,
      open,
      path,
      src,
      thumbnails,
      volume.videoVolume,
      zoom,
    ],
  );

  return {
    ...derivedState,
    loadState,
    videoPaused: lifecycle.videoPaused,
    videoVolume: volume.videoVolume,
    volumePickerOpen: volume.volumePickerOpen,
    externalActionError: lifecycle.externalActionError,
    volumeButtonRef: volume.volumeButtonRef,
    volumeRangeRef: volume.volumeRangeRef,
    handleVideoPlay: lifecycle.handleVideoPlay,
    handleVideoPause: lifecycle.handleVideoPause,
    handleVolumeChange: volume.handleVolumeChange,
    handleVolumePointerDown: volume.handleVolumePointerDown,
    handleVolumePointerUp: volume.handleVolumePointerUp,
    handleTogglePlayback: lifecycle.handleTogglePlayback,
    handleToggleVolumePicker: volume.handleToggleVolumePicker,
    handleVolumeHoverStart: volume.handleVolumeHoverStart,
    handleVolumeHoverEnd: volume.handleVolumeHoverEnd,
    scheduleVolumePickerClose: volume.scheduleVolumePickerClose,
    handleImageLoad: lifecycle.handleImageLoad,
    handleVideoMetadata: lifecycle.handleVideoMetadata,
    handleMediaError: lifecycle.handleMediaError,
    handleOpenExternal: lifecycle.handleOpenExternal,
    handleRevealExternal: lifecycle.handleRevealExternal,
  };
};
