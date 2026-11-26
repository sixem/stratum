// Composes the focused quick preview hooks into the public preview model used
// by the overlay. The heavy state logic lives in smaller hooks and a pure
// derived-state builder.
import { useMemo, useState } from "react";
import { openRemoteFile } from "@/components/remote/remoteOpen";
import { useSettingsStore } from "@/modules";
import type { EntryMeta, ThumbnailLookup } from "@/types";
import type { RefObject } from "react";
import { buildQuickPreviewDerivedState } from "./quickPreviewDerivedState";
import type { PreviewMediaKind } from "./quickPreviewDerivedState";
import { usePreviewMediaLifecycle } from "./usePreviewMediaLifecycle";
import { usePreviewSource } from "./usePreviewSource";
import { usePreviewVolumeController } from "./usePreviewVolumeController";

type UseQuickPreviewMediaOptions = {
  open: boolean;
  path: string | null;
  remote?: { profileId: string; sessionId: number };
  kind: PreviewMediaKind;
  meta?: EntryMeta | null;
  thumbnails: ThumbnailLookup;
  zoom: number;
  mediaRef: RefObject<HTMLMediaElement | null>;
  resetViewport: () => void;
  fitMediaToViewport: (width: number, height: number) => void;
};

const isTauriEnv = () => "__TAURI_INTERNALS__" in globalThis || "__TAURI__" in globalThis;

export const useQuickPreviewMedia = ({
  open,
  path,
  remote,
  kind,
  meta,
  thumbnails,
  zoom,
  mediaRef,
  resetViewport,
  fitMediaToViewport,
}: UseQuickPreviewMediaOptions) => {
  const mediaAutoplay = useSettingsStore((state) => state.videoAutoplay);
  const { src, failed: sourceFailed } = usePreviewSource(open ? path : null, remote);
  const [plainAudioSource, setPlainAudioSource] = useState<string | null>(null);
  const analyseAudio = kind === "audio" && src !== plainAudioSource;
  const playbackKey = analyseAudio ? `${src}#spectrum` : src;
  const previewSessionKey = open ? `open:${path ?? ""}:${analyseAudio}` : "closed";
  const volume = usePreviewVolumeController({ previewSessionKey, isAudio: kind === "audio" });
  const canUseExternalActions = isTauriEnv();
  const lifecycle = usePreviewMediaLifecycle({
    open,
    path,
    src,
    previewSessionKey,
    mediaRef,
    resetViewport,
    fitMediaToViewport,
    canUseExternalActions,
  });
  const loadState = sourceFailed ? "error" : src ? lifecycle.loadState : "loading";

  const derivedState = useMemo(
    () =>
      buildQuickPreviewDerivedState({
        open,
        path,
        src,
        kind,
        meta,
        thumbnails,
        zoom,
        loadState,
        loadedSrc: lifecycle.loadedSrc,
        mediaSize: lifecycle.mediaSize,
        mediaVolume: volume.mediaVolume,
        canUseExternalActions,
      }),
    [
      canUseExternalActions,
      kind,
      lifecycle.loadedSrc,
      lifecycle.mediaSize,
      loadState,
      meta,
      open,
      path,
      src,
      thumbnails,
      volume.mediaVolume,
      zoom,
    ],
  );

  return {
    ...derivedState,
    canRevealExternal: !remote,
    loadState,
    mediaAutoplay,
    analyseAudio,
    playbackKey,
    mediaPaused: lifecycle.mediaPaused,
    mediaVolume: volume.mediaVolume,
    volumePickerOpen: volume.volumePickerOpen,
    externalActionError: lifecycle.externalActionError,
    volumeRangeRef: volume.volumeRangeRef,
    handlePlaybackPlay: lifecycle.handlePlaybackPlay,
    handlePlaybackPause: lifecycle.handlePlaybackPause,
    handleVolumeChange: volume.handleVolumeChange,
    handleVolumePointerDown: volume.handleVolumePointerDown,
    handleVolumePointerUp: volume.handleVolumePointerUp,
    handleTogglePlayback: lifecycle.handleTogglePlayback,
    handleToggleVolumePicker: volume.handleToggleVolumePicker,
    handleVolumeHoverStart: volume.handleVolumeHoverStart,
    handleVolumeHoverEnd: volume.handleVolumeHoverEnd,
    scheduleVolumePickerClose: volume.scheduleVolumePickerClose,
    handleImageLoad: lifecycle.handleImageLoad,
    handlePlaybackMetadata: lifecycle.handlePlaybackMetadata,
    handleMediaError: () => {
      // If the WebView cannot load a CORS-enabled audio source, retry plain playback.
      if (analyseAudio) setPlainAudioSource(src);
      else lifecycle.handleMediaError();
    },
    handleOpenExternal: remote && path
      ? () => openRemoteFile(remote.profileId, remote.sessionId, path)
      : lifecycle.handleOpenExternal,
    handleRevealExternal: lifecycle.handleRevealExternal,
  };
};
