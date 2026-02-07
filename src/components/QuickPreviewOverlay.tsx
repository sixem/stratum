// Full-screen media preview overlay with zoom and pan controls.
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent as ReactSyntheticEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  buildPreviewUrl,
  formatBytes,
  formatCount,
  formatDate,
  getFileKind,
  getPathName,
  isEditableElement,
  splitNameExtension,
} from "@/lib";
import type { EntryMeta, FileEntry, ThumbnailRequest } from "@/types";
import { LoadingIndicator } from "./LoadingIndicator";
import { PressButton } from "./PressButton";
import { QuickPreviewStrip } from "./QuickPreviewStrip";

type QuickPreviewOverlayProps = {
  open: boolean;
  path: string | null;
  meta?: EntryMeta | null;
  items: FileEntry[];
  entryMeta: Map<string, EntryMeta>;
  thumbnails: Map<string, string>;
  thumbnailsEnabled: boolean;
  onRequestMeta: (paths: string[]) => Promise<EntryMeta[]>;
  onRequestThumbs: (requests: ThumbnailRequest[]) => void;
  thumbResetKey?: string;
  loading: boolean;
  onSelectPreview: (path: string) => void;
  smartTabJump: boolean;
};

type DragState = {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const ZOOM_SPEED = 0.0014;
const SEEK_COMMIT_DELAY_MS = 120;
const VOLUME_AUTO_CLOSE_DELAY_MS = 2000;
const TAB_DOUBLE_TAP_MS = 280;
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

const formatMediaTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  const padded = remaining.toString().padStart(2, "0");
  const paddedMinutes = minutes.toString().padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${paddedMinutes}:${padded}`;
  }
  return `${paddedMinutes}:${padded}`;
};

export const QuickPreviewOverlay = ({
  open,
  path,
  meta,
  items,
  entryMeta,
  thumbnails,
  thumbnailsEnabled,
  onRequestMeta,
  onRequestThumbs,
  thumbResetKey,
  loading,
  onSelectPreview,
  smartTabJump,
}: QuickPreviewOverlayProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekCommitTimerRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const volumeButtonRef = useRef<HTMLButtonElement | null>(null);
  const volumeRangeRef = useRef<HTMLInputElement | null>(null);
  const volumeCloseTimerRef = useRef<number | null>(null);
  const volumeAdjustingRef = useRef(false);
  const dragRef = useRef<DragState>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const frameRef = useRef<number | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const loadedPathRef = useRef<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [videoTime, setVideoTime] = useState({ current: 0, duration: 0 });
  const [videoPaused, setVideoPaused] = useState(true);
  const [videoVolume, setVideoVolume] = useState(readPreviewVolume);
  const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [volumePickerOpen, setVolumePickerOpen] = useState(false);
  const lastTabTapRef = useRef(0);
  const [externalActionError, setExternalActionError] = useState<string | null>(null);

  const src = useMemo(() => {
    if (!open || !path) return "";
    return buildPreviewUrl(path);
  }, [open, path]);

  const label = useMemo(() => {
    if (!path) return "Media preview";
    const name = getPathName(path);
    return name || "Media preview";
  }, [path]);
  const previewKind = useMemo(() => {
    if (!path) return "image";
    return getFileKind(getPathName(path));
  }, [path]);
  const isVideo = previewKind === "video";
  const previewItems = useMemo(
    () =>
      items.filter((entry) => {
        if (entry.isDir) return false;
        const kind = getFileKind(entry.name);
        return kind === "image" || kind === "video";
      }),
    [items],
  );
  const previewIndexByPath = useMemo(() => {
    const map = new Map<string, number>();
    previewItems.forEach((entry, index) => {
      map.set(entry.path, index);
    });
    return map;
  }, [previewItems]);

  useEffect(() => {
    // Ensure we do not carry seek state across files (or after closing the overlay).
    if (seekCommitTimerRef.current != null) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    pendingSeekRef.current = null;
    setSeekPreviewTime(null);
    setSeeking(false);

    if (volumeCloseTimerRef.current != null) {
      window.clearTimeout(volumeCloseTimerRef.current);
      volumeCloseTimerRef.current = null;
    }
    volumeAdjustingRef.current = false;
    setVolumePickerOpen(false);

    if (!open) return;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    offsetRef.current = { x: 0, y: 0 };
    setLoadState("loading");
    setMediaSize(null);
    setVideoTime({ current: 0, duration: 0 });
    setVideoPaused(true);
    loadedPathRef.current = null;
    setExternalActionError(null);
  }, [open, path]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (seekCommitTimerRef.current != null) {
        window.clearTimeout(seekCommitTimerRef.current);
        seekCommitTimerRef.current = null;
      }
      if (volumeCloseTimerRef.current != null) {
        window.clearTimeout(volumeCloseTimerRef.current);
        volumeCloseTimerRef.current = null;
      }
    };
  }, []);

  // Keep the volume picker compact by default and only show the slider while it is active.
  // Auto-close after a short idle delay so the controls don't feel "stuck open".
  const clearVolumePickerCloseTimer = () => {
    if (volumeCloseTimerRef.current == null) return;
    window.clearTimeout(volumeCloseTimerRef.current);
    volumeCloseTimerRef.current = null;
  };

  const scheduleVolumePickerClose = (delayMs: number = VOLUME_AUTO_CLOSE_DELAY_MS) => {
    clearVolumePickerCloseTimer();
    volumeCloseTimerRef.current = window.setTimeout(() => {
      volumeCloseTimerRef.current = null;
      const active = document.activeElement;
      setVolumePickerOpen(false);
      if (active === volumeRangeRef.current) {
        volumeButtonRef.current?.focus();
      }
    }, delayMs);
  };

  const handleToggleVolumePicker = () => {
    setVolumePickerOpen((current) => !current);
  };

  useEffect(() => {
    if (!volumePickerOpen) {
      volumeAdjustingRef.current = false;
      clearVolumePickerCloseTimer();
      return;
    }

    scheduleVolumePickerClose();
    const frame = window.requestAnimationFrame(() => volumeRangeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [volumePickerOpen]);

  const scheduleOffset = (next: { x: number; y: number }) => {
    offsetRef.current = next;
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setOffset(offsetRef.current);
    });
  };

  const persistVideoVolume = (value: number) => {
    const clamped = clamp(value, 0, 1);
    setVideoVolume(clamped);
    try {
      window.localStorage.setItem(PREVIEW_VOLUME_KEY, clamped.toString());
    } catch {
      // Ignore persistence failures (private windows, disabled storage).
    }
  };

  // Sync slider state with the native video element.
  const updateVideoTiming = (video: HTMLVideoElement) => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    // `timeupdate` can fire frequently while a video plays. Avoid forcing a React render for
    // tiny changes that would not be visible in the timeline label.
    setVideoTime((previous) => {
      const durationChanged = Math.abs(previous.duration - duration) > 0.01;
      const currentChanged = Math.abs(previous.current - current) > 0.05;
      if (!durationChanged && !currentChanged) return previous;
      return { current, duration };
    });
  };

  useEffect(() => {
    if (!open || !isVideo) return;
    const video = videoRef.current;
    if (!video) return;
    video.volume = videoVolume;
  }, [isVideo, open, src, videoVolume]);

  useEffect(() => {
    if (!open || !isVideo) return;
    const video = videoRef.current;
    if (!video || !video.paused) return;
    // Try autoplay; some webviews may block it with sound, but we prefer to attempt.
    void video.play().catch(() => {});
  }, [isVideo, open, src]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!open) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * ZOOM_SPEED);
    setZoom((value) => clamp(value * factor, MIN_ZOOM, MAX_ZOOM));
  };

  // Let arrow keys walk the preview strip without leaving preview mode.
  useEffect(() => {
    if (!open) return;
    const handleArrowKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.repeat) return;
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown"
      ) {
        return;
      }

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (previewItems.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const delta =
        event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const currentIndex = path ? (previewIndexByPath.get(path) ?? -1) : -1;
      const nextIndex =
        currentIndex < 0
          ? delta > 0
            ? 0
            : previewItems.length - 1
          : clamp(currentIndex + delta, 0, previewItems.length - 1);
      const next = previewItems[nextIndex];
      if (!next) return;
      onSelectPreview(next.path);
    };

    window.addEventListener("keydown", handleArrowKey);
    return () => window.removeEventListener("keydown", handleArrowKey);
  }, [onSelectPreview, open, path, previewIndexByPath, previewItems]);

  // Space is reserved for video playback in preview mode, since it no longer opens preview.
  useEffect(() => {
    if (!open || !isVideo) return;
    const handleSpace = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.repeat) return;

      const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
      if (!isSpace) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (!document.hasFocus()) return;

      event.preventDefault();
      event.stopPropagation();

      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
        void video.play().catch(() => {});
      } else {
        video.pause();
      }
    };

    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [isVideo, open]);

  // Smart Tab jump also works in preview mode to jump the right-hand strip.
  useEffect(() => {
    if (!open || !smartTabJump) return;
    const handleTabJump = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Tab") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.repeat) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (!document.hasFocus()) return;

      event.preventDefault();
      event.stopPropagation();

      const now = performance.now();
      const elapsed = now - lastTabTapRef.current;
      lastTabTapRef.current = now;
      if (elapsed > TAB_DOUBLE_TAP_MS) return;

      const strip = stripRef.current;
      if (!strip) return;
      const maxScrollTop = Math.max(0, strip.scrollHeight - strip.clientHeight);
      if (maxScrollTop <= 0) return;
      const ratio = strip.scrollTop / maxScrollTop;
      strip.scrollTop = ratio < 0.5 ? maxScrollTop : 0;
    };

    window.addEventListener("keydown", handleTabJump);
    return () => window.removeEventListener("keydown", handleTabJump);
  }, [open, smartTabJump]);

  const handleVideoTimeUpdate = (event: ReactSyntheticEvent<HTMLVideoElement>) => {
    updateVideoTiming(event.currentTarget);
  };

  const handleVideoDurationChange = (event: ReactSyntheticEvent<HTMLVideoElement>) => {
    updateVideoTiming(event.currentTarget);
  };

  const handleVideoPlay = () => {
    setVideoPaused(false);
  };

  const handleVideoPause = () => {
    setVideoPaused(true);
  };

  // Seeking a long video can trigger many range requests. To keep things snappy we:
  // - update the UI immediately while the user drags the slider
  // - only commit the actual `video.currentTime` seek on release (or after a short delay
  //   for keyboard interactions)
  const commitSeek = (next: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = next;
    updateVideoTiming(video);
  };

  const scheduleSeekCommit = () => {
    if (seekCommitTimerRef.current != null) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    seekCommitTimerRef.current = window.setTimeout(() => {
      seekCommitTimerRef.current = null;
      const next = pendingSeekRef.current;
      if (next == null) return;
      commitSeek(next);
      pendingSeekRef.current = null;
      setSeekPreviewTime(null);
    }, SEEK_COMMIT_DELAY_MS);
  };

  const handleSeekChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    const next = Number.isFinite(value) ? value : 0;
    pendingSeekRef.current = next;
    setSeekPreviewTime(next);

    // Keyboard changes (arrows / home / end) won't generate pointer up events.
    if (!seeking) {
      scheduleSeekCommit();
    }
  };

  const handleSeekPointerDown = () => {
    setSeeking(true);
  };

  const handleSeekPointerUp = () => {
    setSeeking(false);
    if (seekCommitTimerRef.current != null) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    const next = pendingSeekRef.current;
    if (next == null) {
      setSeekPreviewTime(null);
      return;
    }
    commitSeek(next);
    pendingSeekRef.current = null;
    setSeekPreviewTime(null);
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
    scheduleVolumePickerClose();
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

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!open) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".quick-preview-controls")) {
      return;
    }
    if (target?.closest(".quick-preview-error")) {
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    scheduleOffset({ x: drag.originX + dx, y: drag.originY + dy });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    dragRef.current = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0,
    };
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    dragRef.current.active = false;
    dragRef.current.pointerId = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const handleImageLoad = (event: ReactSyntheticEvent<HTMLImageElement>) => {
    const container = stageRef.current ?? containerRef.current;
    if (container) {
      const bounds = container.getBoundingClientRect();
      const target = event.currentTarget;
      const naturalWidth = target.naturalWidth || target.width;
      const naturalHeight = target.naturalHeight || target.height;
      if (naturalWidth > 0 && naturalHeight > 0) {
        // Fit the full image inside the viewport on first load.
        const fitZoom = Math.min(
          bounds.width / naturalWidth,
          bounds.height / naturalHeight,
          1,
        );
        const nextZoom = clamp(fitZoom, MIN_ZOOM, MAX_ZOOM);
        setZoom(nextZoom);
        setOffset({ x: 0, y: 0 });
        offsetRef.current = { x: 0, y: 0 };
        setMediaSize({ width: naturalWidth, height: naturalHeight });
      }
    }
    loadedPathRef.current = path ?? null;
    setLoadState("ready");
  };

  const handleVideoMetadata = (event: ReactSyntheticEvent<HTMLVideoElement>) => {
    const container = stageRef.current ?? containerRef.current;
    const target = event.currentTarget;
    const naturalWidth = target.videoWidth;
    const naturalHeight = target.videoHeight;
    if (container && naturalWidth > 0 && naturalHeight > 0) {
      const bounds = container.getBoundingClientRect();
      const fitZoom = Math.min(
        bounds.width / naturalWidth,
        bounds.height / naturalHeight,
        1,
      );
      const nextZoom = clamp(fitZoom, MIN_ZOOM, MAX_ZOOM);
      setZoom(nextZoom);
      setOffset({ x: 0, y: 0 });
      offsetRef.current = { x: 0, y: 0 };
      setMediaSize({ width: naturalWidth, height: naturalHeight });
    }
    target.volume = videoVolume;
    updateVideoTiming(target);
    setVideoPaused(target.paused);
    loadedPathRef.current = path ?? null;
    setLoadState("ready");
  };

  if (!open || !path) {
    return null;
  }

  const isReady = loadState === "ready" && loadedPathRef.current === path;
  const isLoading = loadState === "loading" || (!isReady && loadState !== "error");
  const hasError = loadState === "error";
  const name = getPathName(path);
  const extension = splitNameExtension(name).extension;
  const typeLabel = extension
    ? extension.toUpperCase()
    : isVideo
      ? "Video"
      : "Image";
  const sizeLabel = formatBytes(meta?.size ?? null);
  const modifiedLabel = meta?.modified == null ? "-" : formatDate(meta.modified);
  const dimensionLabel = mediaSize
    ? `${formatCount(mediaSize.width)} x ${formatCount(mediaSize.height)}`
    : "...";
  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const videoPoster = isVideo ? thumbnails.get(path) : undefined;
  const safeDuration = Number.isFinite(videoTime.duration) ? videoTime.duration : 0;
  const safeCurrentTime = Number.isFinite(videoTime.current) ? videoTime.current : 0;
  const clampedPlaybackTime = safeDuration > 0 ? clamp(safeCurrentTime, 0, safeDuration) : 0;
  const clampedSeekTime =
    seekPreviewTime == null
      ? null
      : safeDuration > 0
        ? clamp(seekPreviewTime, 0, safeDuration)
        : 0;
  const displayTime = clampedSeekTime ?? clampedPlaybackTime;
  const currentTimeLabel = formatMediaTime(displayTime);
  const durationTimeLabel = formatMediaTime(safeDuration);
  const timeLabel = `${currentTimeLabel}/${durationTimeLabel}`;
  const volumeLabel = `${Math.round(videoVolume * 100)}%`;
  const titleText = name || (isVideo ? "Video" : "Image");
  // Use intrinsic dimensions so videos don't fall back to the default 300x150 box.
  const mediaStyle = mediaSize
    ? {
        width: `${mediaSize.width}px`,
        height: `${mediaSize.height}px`,
        maxWidth: "none",
        maxHeight: "none",
        transform: `scale(${zoom})`,
      }
    : { transform: `scale(${zoom})` };

  const handleOpenExternal = async () => {
    if (!isTauriEnv()) return;
    setExternalActionError(null);
    try {
      await openPath(path);
    } catch {
      setExternalActionError("Unable to open this file with the system default app.");
    }
  };

  const handleRevealExternal = async () => {
    if (!isTauriEnv()) return;
    setExternalActionError(null);
    try {
      await revealItemInDir(path);
    } catch {
      setExternalActionError("Unable to reveal this file in your system file explorer.");
    }
  };

  const errorTitle = isVideo ? "Video preview unavailable" : "Preview unavailable";
  const errorSummary = isVideo
    ? "Stratum plays videos using your system webview’s built-in media decoder."
    : "Stratum previews files using your system webview.";
  const errorDetail = isVideo
    ? "Some containers/codecs (often MKV/H.265/AV1, depending on your OS) aren’t supported there, so playback can fail."
    : "If the file format isn’t supported there, rendering can fail.";

  return (
    <div
      className="quick-preview"
      data-open={open ? "true" : "false"}
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
    >
      <div
        className={`quick-preview-stage${dragging ? " is-dragging" : ""}`}
        ref={stageRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div
          className="quick-preview-pan"
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
        >
          {isVideo ? (
            <video
              key={src}
              className="quick-preview-media is-video"
              src={src}
              poster={videoPoster}
              playsInline
              preload="metadata"
              autoPlay
              loop
              draggable={false}
              onLoadedMetadata={handleVideoMetadata}
              onTimeUpdate={handleVideoTimeUpdate}
              onDurationChange={handleVideoDurationChange}
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              ref={videoRef}
              onError={() => {
                loadedPathRef.current = null;
                setLoadState("error");
              }}
              data-ready={isReady ? "true" : "false"}
              style={mediaStyle}
            />
          ) : (
            <img
              key={src}
              className="quick-preview-media is-image"
              src={src}
              alt={label}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              onLoad={handleImageLoad}
              onError={() => {
                loadedPathRef.current = null;
                setLoadState("error");
              }}
              data-ready={isReady ? "true" : "false"}
              style={mediaStyle}
            />
          )}
        </div>
        {hasError ? (
          <div className="quick-preview-error" role="status" aria-live="polite">
            <div className="quick-preview-error-card">
              <div className="quick-preview-error-title">{errorTitle}</div>
              <div className="quick-preview-error-desc">
                {errorSummary} {errorDetail}
              </div>
              <div className="quick-preview-error-meta">
                <div className="quick-preview-error-meta-row">
                  <span className="quick-preview-error-meta-label">File</span>
                  <span className="quick-preview-error-meta-value">{name}</span>
                </div>
                <div className="quick-preview-error-meta-row">
                  <span className="quick-preview-error-meta-label">Type</span>
                  <span className="quick-preview-error-meta-value">{typeLabel}</span>
                </div>
              </div>
              {isTauriEnv() ? (
                <div className="quick-preview-error-actions">
                  <PressButton type="button" className="btn" onClick={handleOpenExternal}>
                    Open in default app
                  </PressButton>
                  <PressButton
                    type="button"
                    className="btn ghost"
                    onClick={handleRevealExternal}
                  >
                    Reveal in folder
                  </PressButton>
                </div>
              ) : null}
              {externalActionError ? (
                <div className="quick-preview-error-hint" role="status">
                  {externalActionError}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <QuickPreviewStrip
        open={open}
        items={previewItems}
        activePath={path}
        entryMeta={entryMeta}
        thumbnails={thumbnails}
        thumbnailsEnabled={thumbnailsEnabled}
        onRequestMeta={onRequestMeta}
        onRequestThumbs={onRequestThumbs}
        thumbResetKey={thumbResetKey}
        loading={loading}
        onSelect={onSelectPreview}
        stripRef={stripRef}
      />
      <div className="quick-preview-loading" data-visible={isLoading ? "true" : "false"}>
        <div className="quick-preview-loading-card">
          <LoadingIndicator label={isVideo ? "Loading video" : "Loading image"} />
        </div>
      </div>
      <div key={path ?? "preview-title"} className="quick-preview-title">
        {titleText}
      </div>
      {isVideo ? (
        <div className="quick-preview-controls">
          <button
            type="button"
            className="quick-preview-control-button quick-preview-control-button--playback"
            onClick={handleTogglePlayback}
          >
            {videoPaused ? "Play" : "Pause"}
          </button>
          <div
            className="quick-preview-control-volume"
            data-open={volumePickerOpen ? "true" : "false"}
          >
            <button
              type="button"
              className="quick-preview-control-button quick-preview-control-volume-button"
              onClick={handleToggleVolumePicker}
              ref={volumeButtonRef}
              aria-expanded={volumePickerOpen ? "true" : "false"}
              aria-controls="quick-preview-volume-range"
              aria-label={`Preview volume ${volumeLabel}`}
            >
              {volumeLabel}
            </button>
            <div className="quick-preview-control-volume-slider">
              <input
                ref={volumeRangeRef}
                id="quick-preview-volume-range"
                className="quick-preview-control-range"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={videoVolume}
                onChange={handleVolumeChange}
                onPointerDown={handleVolumePointerDown}
                onPointerUp={handleVolumePointerUp}
                onPointerCancel={handleVolumePointerUp}
                onBlur={() => scheduleVolumePickerClose(220)}
                aria-label="Preview volume"
                disabled={!volumePickerOpen}
              />
            </div>
          </div>
          <div className="quick-preview-control-seek">
            <input
              className="quick-preview-control-range"
              type="range"
              min={0}
              max={safeDuration || 1}
              step={0.1}
              value={displayTime}
              onChange={handleSeekChange}
              onPointerDown={handleSeekPointerDown}
              onPointerUp={handleSeekPointerUp}
              onPointerCancel={handleSeekPointerUp}
              aria-label="Video timeline"
              disabled={safeDuration === 0}
            />
            <div className="quick-preview-control-time">{timeLabel}</div>
          </div>
        </div>
      ) : null}
      <div className="quick-preview-info" aria-live="polite">
        {hasError ? (
          <div className="quick-preview-info-error" role="status">
            Preview unavailable. Try opening the file externally.
          </div>
        ) : null}
        <div className="quick-preview-info-row">
          <div className="quick-preview-info-item">
            <span className="quick-preview-info-label">Type</span>
            <span className="quick-preview-info-value">{typeLabel}</span>
          </div>
          <div className="quick-preview-info-item">
            <span className="quick-preview-info-label">Dimensions</span>
            <span className="quick-preview-info-value">{dimensionLabel}</span>
          </div>
          <div className="quick-preview-info-item">
            <span className="quick-preview-info-label">Size</span>
            <span className="quick-preview-info-value">{sizeLabel}</span>
          </div>
          <div className="quick-preview-info-item">
            <span className="quick-preview-info-label">Modified</span>
            <span className="quick-preview-info-value">{modifiedLabel}</span>
          </div>
          <div className="quick-preview-info-item">
            <span className="quick-preview-info-label">Zoom</span>
            <span className="quick-preview-info-value">{zoomLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
