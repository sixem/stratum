// Owns media element lifecycle, metadata synchronization, and external
// open/reveal actions for the quick preview overlay.
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RefObject,
  SyntheticEvent as ReactSyntheticEvent,
} from "react";
import type { PreviewMediaKind, QuickPreviewLoadState } from "./quickPreviewDerivedState";

type UsePreviewMediaLifecycleOptions = {
  open: boolean;
  path: string | null;
  src: string;
  kind: PreviewMediaKind;
  previewSessionKey: string;
  mediaRef: RefObject<HTMLMediaElement | null>;
  resetViewport: () => void;
  fitMediaToViewport: (width: number, height: number) => void;
  videoAutoplay: boolean;
  canUseExternalActions: boolean;
};

export const usePreviewMediaLifecycle = ({
  open,
  path,
  src,
  kind,
  previewSessionKey,
  mediaRef,
  resetViewport,
  fitMediaToViewport,
  videoAutoplay,
  canUseExternalActions,
}: UsePreviewMediaLifecycleOptions) => {
  const previewSessionRef = useRef("");
  const loadedSrcRef = useRef<string | null>(null);
  const loadStateRef = useRef<QuickPreviewLoadState>("loading");
  const [loadState, setLoadState] = useState<QuickPreviewLoadState>("loading");
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [mediaPaused, setMediaPaused] = useState(true);
  const [externalActionError, setExternalActionError] = useState<string | null>(null);

  const setLoadStateIfChanged = useCallback((next: QuickPreviewLoadState) => {
    if (loadStateRef.current === next) return;
    loadStateRef.current = next;
    setLoadState(next);
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
    setMediaPaused(true);
    loadedSrcRef.current = null;
    setExternalActionError((prev) => (prev == null ? prev : null));
  }, [
    open,
    previewSessionKey,
    resetViewport,
    setLoadStateIfChanged,
    setMediaSizeIfChanged,
  ]);

  useEffect(() => {
    if (!open || kind !== "video" || !src || !videoAutoplay) return;
    const media = mediaRef.current;
    if (media?.paused) void media.play().catch(() => {});
  }, [kind, mediaRef, open, src, videoAutoplay]);

  const handlePlaybackPlay = useCallback(() => setMediaPaused(false), []);

  const handlePlaybackPause = useCallback(() => setMediaPaused(true), []);

  const handleTogglePlayback = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) {
      void media.play().catch(() => {});
    } else {
      media.pause();
    }
  }, [mediaRef]);

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

  const syncPlaybackMetadata = useCallback(
    (media: HTMLMediaElement) => {
      if (media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0) {
        fitMediaToViewport(media.videoWidth, media.videoHeight);
        setMediaSizeIfChanged({ width: media.videoWidth, height: media.videoHeight });
      }
      setMediaPaused(media.paused);
      loadedSrcRef.current = src || null;
      setLoadStateIfChanged("ready");
    },
    [
      fitMediaToViewport,
      setLoadStateIfChanged,
      setMediaSizeIfChanged,
      src,
    ],
  );

  // If metadata was already available before React observed loadedmetadata,
  // synchronize state from the current element to avoid a stuck loading mask.
  useEffect(() => {
    if (!open || !src) return;
    const media = mediaRef.current;
    if (media && media.readyState >= HTMLMediaElement.HAVE_METADATA) syncPlaybackMetadata(media);
  }, [mediaRef, open, src, syncPlaybackMetadata]);

  const handlePlaybackMetadata = useCallback(
    (event: ReactSyntheticEvent<HTMLMediaElement>) => {
      syncPlaybackMetadata(event.currentTarget);
    },
    [syncPlaybackMetadata],
  );

  const handleMediaError = useCallback(() => {
    loadedSrcRef.current = null;
    setMediaPaused(true);
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
    mediaPaused,
    externalActionError,
    handlePlaybackPlay,
    handlePlaybackPause,
    handleTogglePlayback,
    handleImageLoad,
    handlePlaybackMetadata,
    handleMediaError,
    handleOpenExternal,
    handleRevealExternal,
  };
};
