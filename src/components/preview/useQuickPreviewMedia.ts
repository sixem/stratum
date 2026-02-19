// Manages preview media lifecycle, volume UX, metadata labels, and external actions.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  CSSProperties,
  RefObject,
  SyntheticEvent as ReactSyntheticEvent,
} from "react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  buildPreviewUrl,
  formatBytes,
  formatCount,
  formatDate,
  getFileKind,
  getPathName,
  splitNameExtension,
} from "@/lib";
import type { EntryMeta, FileEntry } from "@/types";

type UseQuickPreviewMediaOptions = {
  open: boolean;
  path: string | null;
  meta?: EntryMeta | null;
  items: FileEntry[];
  thumbnails: Map<string, string>;
  zoom: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  resetViewport: () => void;
  fitMediaToViewport: (width: number, height: number) => void;
};

const VOLUME_AUTO_CLOSE_DELAY_MS = 2000;
const VOLUME_HOVER_OPEN_DELAY_MS = 250;
const PREVIEW_VOLUME_KEY = "stratum.preview.volume";

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const isTauriEnv = () => "__TAURI_INTERNALS__" in globalThis || "__TAURI__" in globalThis;

// Keep preview volume sticky so the overlay feels consistent between files.
const readPreviewVolume = () => {
  const fallback = 0.1;
  try {
    const stored = window.localStorage.getItem(PREVIEW_VOLUME_KEY);
    if (stored == null) {
      window.localStorage.setItem(PREVIEW_VOLUME_KEY, fallback.toString());
      return fallback;
    }
    const parsed = Number(stored);
    if (!Number.isFinite(parsed)) {
      window.localStorage.setItem(PREVIEW_VOLUME_KEY, fallback.toString());
      return fallback;
    }
    const clamped = clamp(parsed, 0, 1);
    if (clamped !== parsed) {
      window.localStorage.setItem(PREVIEW_VOLUME_KEY, clamped.toString());
    }
    return clamped;
  } catch {
    return fallback;
  }
};

export const useQuickPreviewMedia = ({
  open,
  path,
  meta,
  items,
  thumbnails,
  zoom,
  videoRef,
  resetViewport,
  fitMediaToViewport,
}: UseQuickPreviewMediaOptions) => {
  const previewSessionRef = useRef<string>("");
  const volumeButtonRef = useRef<HTMLButtonElement | null>(null);
  const volumeRangeRef = useRef<HTMLInputElement | null>(null);
  const volumeCloseTimerRef = useRef<number | null>(null);
  const volumeHoverTimerRef = useRef<number | null>(null);
  const volumeAdjustingRef = useRef(false);
  const volumePinnedOpenRef = useRef(false);
  const loadedSrcRef = useRef<string | null>(null);
  const loadStateRef = useRef<"loading" | "ready" | "error">("loading");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(null);
  const [videoPaused, setVideoPaused] = useState(true);
  const [videoVolume, setVideoVolume] = useState(readPreviewVolume);
  const [volumePickerOpen, setVolumePickerOpen] = useState(false);
  const [externalActionError, setExternalActionError] = useState<string | null>(null);
  const setLoadStateIfChanged = useCallback((next: "loading" | "ready" | "error") => {
    if (loadStateRef.current === next) return;
    loadStateRef.current = next;
    setLoadState(next);
  }, []);
  const setVideoPausedIfChanged = useCallback((next: boolean) => {
    setVideoPaused((prev) => (prev === next ? prev : next));
  }, []);
  const setMediaSizeIfChanged = useCallback((next: { width: number; height: number } | null) => {
    setMediaSize((prev) => {
      if (prev == null && next == null) return prev;
      if (prev && next && prev.width === next.width && prev.height === next.height) {
        return prev;
      }
      return next;
    });
  }, []);
  const previewSessionKey = open ? `open:${path ?? ""}` : "closed";

  const src = useMemo(() => {
    if (!open || !path) return "";
    return buildPreviewUrl(path);
  }, [open, path]);

  const label = useMemo(() => {
    if (!open || !path) return "Media preview";
    const name = getPathName(path);
    return name || "Media preview";
  }, [open, path]);

  const previewKind = useMemo(() => {
    if (!open || !path) return "image";
    return getFileKind(getPathName(path));
  }, [open, path]);

  const isVideo = previewKind === "video";

  const previewItems = useMemo(
    () => {
      if (!open) return [] as FileEntry[];
      return items.filter((entry) => {
        if (entry.isDir) return false;
        const kind = getFileKind(entry.name);
        return kind === "image" || kind === "video";
      });
    },
    [items, open],
  );

  useEffect(() => {
    if (previewSessionRef.current === previewSessionKey) return;
    previewSessionRef.current = previewSessionKey;

    if (volumeCloseTimerRef.current != null) {
      window.clearTimeout(volumeCloseTimerRef.current);
      volumeCloseTimerRef.current = null;
    }
    volumeAdjustingRef.current = false;
    volumePinnedOpenRef.current = false;
    setVolumePickerOpen((prev) => (prev ? false : prev));

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
    return () => {
      if (volumeCloseTimerRef.current != null) {
        window.clearTimeout(volumeCloseTimerRef.current);
        volumeCloseTimerRef.current = null;
      }
      if (volumeHoverTimerRef.current != null) {
        window.clearTimeout(volumeHoverTimerRef.current);
        volumeHoverTimerRef.current = null;
      }
    };
  }, []);

  const clearVolumePickerCloseTimer = () => {
    if (volumeCloseTimerRef.current == null) return;
    window.clearTimeout(volumeCloseTimerRef.current);
    volumeCloseTimerRef.current = null;
  };

  const clearVolumeHoverOpenTimer = () => {
    if (volumeHoverTimerRef.current == null) return;
    window.clearTimeout(volumeHoverTimerRef.current);
    volumeHoverTimerRef.current = null;
  };

  const scheduleVolumePickerClose = (delayMs: number = VOLUME_AUTO_CLOSE_DELAY_MS) => {
    if (volumePinnedOpenRef.current) return;
    clearVolumePickerCloseTimer();
    volumeCloseTimerRef.current = window.setTimeout(() => {
      volumeCloseTimerRef.current = null;
      const active = document.activeElement;
      setVolumePickerOpen((prev) => (prev ? false : prev));
      if (active === volumeRangeRef.current) {
        volumeButtonRef.current?.focus();
      }
    }, delayMs);
  };

  const handleToggleVolumePicker = () => {
    clearVolumePickerCloseTimer();
    clearVolumeHoverOpenTimer();
    setVolumePickerOpen((current) => {
      if (!current) {
        volumePinnedOpenRef.current = true;
        return true;
      }
      if (!volumePinnedOpenRef.current) {
        volumePinnedOpenRef.current = true;
        return true;
      }
      volumePinnedOpenRef.current = false;
      return false;
    });
  };

  const handleVolumeHoverStart = () => {
    clearVolumePickerCloseTimer();
    clearVolumeHoverOpenTimer();
    volumeHoverTimerRef.current = window.setTimeout(() => {
      volumeHoverTimerRef.current = null;
      if (volumePinnedOpenRef.current) return;
      setVolumePickerOpen(true);
    }, VOLUME_HOVER_OPEN_DELAY_MS);
  };

  const handleVolumeHoverEnd = () => {
    clearVolumeHoverOpenTimer();
    if (volumePinnedOpenRef.current) return;
    if (volumeAdjustingRef.current) return;
    scheduleVolumePickerClose(260);
  };

  useEffect(() => {
    if (!volumePickerOpen) {
      volumeAdjustingRef.current = false;
      volumePinnedOpenRef.current = false;
      clearVolumePickerCloseTimer();
      return;
    }

    if (!volumePinnedOpenRef.current) {
      scheduleVolumePickerClose();
    }
    const frame = window.requestAnimationFrame(() => volumeRangeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [volumePickerOpen]);

  const persistVideoVolume = (value: number) => {
    const clamped = clamp(value, 0, 1);
    setVideoVolume((prev) => (prev === clamped ? prev : clamped));
    try {
      window.localStorage.setItem(PREVIEW_VOLUME_KEY, clamped.toString());
    } catch {
      // Ignore persistence failures (private windows, disabled storage).
    }
  };

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

  const handleVideoPlay = () => {
    setVideoPausedIfChanged(false);
  };

  const handleVideoPause = () => {
    setVideoPausedIfChanged(true);
  };

  const handleVolumeChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    persistVideoVolume(Number.isFinite(value) ? value : 1);
    if (volumeAdjustingRef.current) return;
    scheduleVolumePickerClose();
  };

  const handleVolumePointerDown = () => {
    volumeAdjustingRef.current = true;
    clearVolumePickerCloseTimer();
  };

  const handleVolumePointerUp = () => {
    volumeAdjustingRef.current = false;
    if (!volumePinnedOpenRef.current) {
      scheduleVolumePickerClose();
    }
  };

  const handleTogglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const handleImageLoad = (event: ReactSyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget;
    const naturalWidth = target.naturalWidth || target.width;
    const naturalHeight = target.naturalHeight || target.height;
    if (naturalWidth > 0 && naturalHeight > 0) {
      fitMediaToViewport(naturalWidth, naturalHeight);
      setMediaSizeIfChanged({ width: naturalWidth, height: naturalHeight });
    }
    loadedSrcRef.current = src || null;
    setLoadStateIfChanged("ready");
  };

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

  const handleVideoMetadata = (event: ReactSyntheticEvent<HTMLVideoElement>) => {
    syncVideoMetadata(event.currentTarget);
  };

  const handleMediaError = () => {
    loadedSrcRef.current = null;
    setLoadStateIfChanged("error");
  };

  const handleOpenExternal = async () => {
    if (!path || !isTauriEnv()) return;
    setExternalActionError(null);
    try {
      await openPath(path);
    } catch {
      setExternalActionError("Unable to open this file with the system default app.");
    }
  };

  const handleRevealExternal = async () => {
    if (!path || !isTauriEnv()) return;
    setExternalActionError(null);
    try {
      await revealItemInDir(path);
    } catch {
      setExternalActionError("Unable to reveal this file in your system file explorer.");
    }
  };

  const isReady = loadState === "ready" && loadedSrcRef.current === src;
  const isLoading = loadState === "loading" || (!isReady && loadState !== "error");
  const hasError = loadState === "error";
  const name = getPathName(path ?? "");
  const extension = splitNameExtension(name).extension;
  const typeLabel = extension ? extension.toUpperCase() : isVideo ? "Video" : "Image";
  const sizeLabel = formatBytes(meta?.size ?? null);
  const modifiedLabel = meta?.modified == null ? "-" : formatDate(meta.modified);
  const dimensionLabel = mediaSize
    ? `${formatCount(mediaSize.width)} x ${formatCount(mediaSize.height)}`
    : "...";
  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const videoPoster = isVideo && path ? thumbnails.get(path) : undefined;
  const volumeLabel = `${Math.round(videoVolume * 100)}%`;
  const titleText = name || (isVideo ? "Video" : "Image");
  const volumeProgress = clamp(videoVolume * 100, 0, 100);
  const volumeStyle = {
    "--preview-volume-progress": `${volumeProgress}%`,
  } as CSSProperties;
  const mediaStyle = mediaSize
    ? {
        width: `${mediaSize.width}px`,
        height: `${mediaSize.height}px`,
        maxWidth: "none",
        maxHeight: "none",
        transform: `scale(${zoom})`,
      }
    : { transform: `scale(${zoom})` };

  return {
    src,
    label,
    isVideo,
    previewItems,
    loadState,
    isReady,
    isLoading,
    hasError,
    titleText,
    name,
    typeLabel,
    sizeLabel,
    modifiedLabel,
    dimensionLabel,
    zoomLabel,
    videoPoster,
    videoPaused,
    videoVolume,
    volumeLabel,
    volumeStyle,
    volumePickerOpen,
    mediaStyle,
    externalActionError,
    canUseExternalActions: isTauriEnv(),
    volumeButtonRef,
    volumeRangeRef,
    handleVideoPlay,
    handleVideoPause,
    handleVolumeChange,
    handleVolumePointerDown,
    handleVolumePointerUp,
    handleTogglePlayback,
    handleToggleVolumePicker,
    handleVolumeHoverStart,
    handleVolumeHoverEnd,
    scheduleVolumePickerClose,
    handleImageLoad,
    handleVideoMetadata,
    handleMediaError,
    handleOpenExternal,
    handleRevealExternal,
  };
};
