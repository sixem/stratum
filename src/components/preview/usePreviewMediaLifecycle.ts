// Owns media element lifecycle, metadata synchronization, and external
// open/reveal actions for the quick preview overlay.
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RefObject,
  SyntheticEvent as ReactSyntheticEvent,
} from "react";
import type { QuickPreviewLoadState } from "./quickPreviewDerivedState";

type UsePreviewMediaLifecycleOptions = {
  open: boolean;
  path: string | null;
  src: string;
  isVideo: boolean;
  previewSessionKey: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  resetViewport: () => void;
  fitMediaToViewport: (width: number, height: number) => void;
  videoVolume: number;
  canUseExternalActions: boolean;
};

export const usePreviewMediaLifecycle = ({
  open,
  path,
  src,
  isVideo,
  previewSessionKey,
  videoRef,
  resetViewport,
  fitMediaToViewport,
  videoVolume,
  canUseExternalActions,
}: UsePreviewMediaLifecycleOptions) => {
  const previewSessionRef = useRef("");
  const loadedSrcRef = useRef<string | null>(null);
  const loadStateRef = useRef<QuickPreviewLoadState>("loading");
  const [loadState, setLoadState] = useState<QuickPreviewLoadState>("loading");
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [videoPaused, setVideoPaused] = useState(true);
  const [externalActionError, setExternalActionError] = useState<string | null>(null);

  const setLoadStateIfChanged = useCallback((next: QuickPreviewLoadState) => {
    if (loadStateRef.current === next) return;
    loadStateRef.current = next;
    setLoadState(next);
  }, []);

  const setVideoPausedIfChanged = useCallback((next: boolean) => {
    setVideoPaused((prev) => (prev === next ? prev : next));
  }, []);

  const setMediaSizeIfChanged = useCallback(
    (next: { width: number; height: number } | null) => {
      setMediaSize((prev) => {
        if (prev == null && next == null) return prev;
        if (prev && next && prev.width === next.width && prev.height === next.height) {
          return prev;
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (previewSessionRef.current === previewSessionKey) return;
    previewSessionRef.current = previewSessionKey;

    if (!open) return;
    resetViewport();
    setLoadStateIfChanged("loading");
    setMediaSizeIfChanged(null);
    setVideoPausedIfChanged(true);
    loadedSrcRef.current = null;
    setExternalActionError((prev) => (prev == null ? prev : null));
  }, [
    open,
    previewSessionKey,
    resetViewport,
    setLoadStateIfChanged,
    setMediaSizeIfChanged,
    setVideoPausedIfChanged,
  ]);

  useEffect(() => {
    if (!open || !isVideo) return;
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.volume - videoVolume) > 0.001) {
      video.volume = videoVolume;
    }
  }, [isVideo, open, src, videoRef, videoVolume]);

  useEffect(() => {
    if (!open || !isVideo) return;
    const video = videoRef.current;
    if (!video || !video.paused) return;
    void video.play().catch(() => {});
  }, [isVideo, open, src, videoRef]);

  const handleVideoPlay = useCallback(() => {
    setVideoPausedIfChanged(false);
  }, [setVideoPausedIfChanged]);

  const handleVideoPause = useCallback(() => {
    setVideoPausedIfChanged(true);
  }, [setVideoPausedIfChanged]);

  const handleTogglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [videoRef]);

  const handleImageLoad = useCallback(
    (event: ReactSyntheticEvent<HTMLImageElement>) => {
      const target = event.currentTarget;
      const naturalWidth = target.naturalWidth || target.width;
      const naturalHeight = target.naturalHeight || target.height;
      if (naturalWidth > 0 && naturalHeight > 0) {
        fitMediaToViewport(naturalWidth, naturalHeight);
        setMediaSizeIfChanged({ width: naturalWidth, height: naturalHeight });
      }
      loadedSrcRef.current = src || null;
      setLoadStateIfChanged("ready");
    },
    [fitMediaToViewport, setLoadStateIfChanged, setMediaSizeIfChanged, src],
  );

  const syncVideoMetadata = useCallback(
    (video: HTMLVideoElement) => {
      const naturalWidth = video.videoWidth;
      const naturalHeight = video.videoHeight;
      if (naturalWidth > 0 && naturalHeight > 0) {
        fitMediaToViewport(naturalWidth, naturalHeight);
        setMediaSizeIfChanged({ width: naturalWidth, height: naturalHeight });
      }
      video.volume = videoVolume;
      setVideoPausedIfChanged(video.paused);
      loadedSrcRef.current = src || null;
      setLoadStateIfChanged("ready");
    },
    [
      fitMediaToViewport,
      setLoadStateIfChanged,
      setMediaSizeIfChanged,
      setVideoPausedIfChanged,
      src,
      videoVolume,
    ],
  );

  // If metadata was already available before React observed loadedmetadata,
  // synchronize state from the current element to avoid a stuck loading mask.
  useEffect(() => {
    if (!open || !isVideo || !src) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    syncVideoMetadata(video);
  }, [isVideo, open, src, syncVideoMetadata, videoRef]);

  const handleVideoMetadata = useCallback(
    (event: ReactSyntheticEvent<HTMLVideoElement>) => {
      syncVideoMetadata(event.currentTarget);
    },
    [syncVideoMetadata],
  );

  const handleMediaError = useCallback(() => {
    loadedSrcRef.current = null;
    setLoadStateIfChanged("error");
  }, [setLoadStateIfChanged]);

  const handleOpenExternal = useCallback(async () => {
    if (!path || !canUseExternalActions) return;
    setExternalActionError(null);
    try {
      await openPath(path);
    } catch {
      setExternalActionError("Unable to open this file with the system default app.");
    }
  }, [canUseExternalActions, path]);

  const handleRevealExternal = useCallback(async () => {
    if (!path || !canUseExternalActions) return;
    setExternalActionError(null);
    try {
      await revealItemInDir(path);
    } catch {
      setExternalActionError("Unable to reveal this file in your system file explorer.");
    }
  }, [canUseExternalActions, path]);

  return {
    loadState,
    loadedSrc: loadedSrcRef.current,
    mediaSize,
    videoPaused,
    externalActionError,
    handleVideoPlay,
    handleVideoPause,
    handleTogglePlayback,
    handleImageLoad,
    handleVideoMetadata,
    handleMediaError,
    handleOpenExternal,
    handleRevealExternal,
  };
};
