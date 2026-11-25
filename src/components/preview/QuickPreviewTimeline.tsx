// Shared audio and video timeline for preview mode.
// Uses direct CSS variable updates for smooth playhead motion without per-frame React renders.
import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

type QuickPreviewTimelineProps = {
  mediaRef: RefObject<HTMLMediaElement | null>;
  mediaKey: string;
  open: boolean;
  disabled: boolean;
  onCommitSeek?: (seconds: number) => void;
};

type TimelineLabels = {
  current: string;
  remaining: string;
  now: number;
  max: number;
};

const LABEL_UPDATE_MS = 100;
const SHIFT_ARROW_STEP_SECONDS = 5;
const DECODER_DRIFT_THRESHOLD = 0.2;

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
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

const resolveDuration = (media: HTMLMediaElement | null) => {
  if (!media) return 0;
  const duration = media.duration;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return duration;
};

export const QuickPreviewTimeline = ({
  mediaRef,
  mediaKey,
  open,
  disabled,
  onCommitSeek,
}: QuickPreviewTimelineProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const progressRef = useRef<number>(-1);
  const lastLabelUpdateRef = useRef(0);
  const durationRef = useRef(0);
  const displayRef = useRef(0);
  const dragActiveRef = useRef(false);
  const dragPointerIdRef = useRef<number | null>(null);
  const previewTimeRef = useRef<number | null>(null);
  const playheadAnchorRef = useRef({ time: 0, perf: 0 });
  const [dragging, setDragging] = useState(false);
  const [labels, setLabels] = useState<TimelineLabels>({
    current: "00:00",
    remaining: "00:00",
    now: 0,
    max: 0,
  });
  const setDraggingIfChanged = (next: boolean) => {
    setDragging((prev) => (prev === next ? prev : next));
  };

  const writeProgress = (time: number, duration: number) => {
    const root = rootRef.current;
    if (!root) return;
    const progress = duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0;
    if (Math.abs(progressRef.current - progress) < 0.001) return;
    progressRef.current = progress;
    root.style.setProperty("--preview-seek-progress", `${progress}%`);
  };

  const syncDisplay = (time: number, duration: number, forceLabel = false) => {
    const clampedDuration = Math.max(0, duration);
    const clampedTime = clampedDuration > 0 ? clamp(time, 0, clampedDuration) : 0;
    displayRef.current = clampedTime;
    durationRef.current = clampedDuration;
    writeProgress(clampedTime, clampedDuration);

    const now = performance.now();
    if (!forceLabel && now - lastLabelUpdateRef.current < LABEL_UPDATE_MS) {
      return;
    }
    lastLabelUpdateRef.current = now;
    const nextLabels: TimelineLabels = {
      current: formatMediaTime(clampedTime),
      remaining: formatMediaTime(Math.max(0, clampedDuration - clampedTime)),
      now: clampedTime,
      max: clampedDuration,
    };
    setLabels((prev) => {
      if (
        prev.current === nextLabels.current &&
        prev.remaining === nextLabels.remaining &&
        Math.abs(prev.now - nextLabels.now) < 0.001 &&
        Math.abs(prev.max - nextLabels.max) < 0.001
      ) {
        return prev;
      }
      return nextLabels;
    });
  };

  const commitSeek = (time: number) => {
    const media = mediaRef.current;
    const duration = resolveDuration(media);
    if (!media || duration <= 0) return;
    const target = clamp(time, 0, duration);
    if (typeof media.fastSeek === "function") {
      try {
        media.fastSeek(target);
      } catch {
        media.currentTime = target;
      }
    } else {
      media.currentTime = target;
    }
    playheadAnchorRef.current = { time: target, perf: performance.now() };
    onCommitSeek?.(target);
    syncDisplay(target, duration, true);
  };

  const resolveTimeFromPointer = (clientX: number) => {
    const root = rootRef.current;
    if (!root) return 0;
    const duration = durationRef.current;
    if (duration <= 0) return 0;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return ratio * duration;
  };

  useEffect(() => {
    const media = mediaRef.current;
    if (!open || !media || !mediaKey) {
      playheadAnchorRef.current = { time: 0, perf: 0 };
      syncDisplay(0, 0, true);
      return;
    }

    const canAnimate = () => !document.hidden && !media.paused && !media.ended &&
      media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
    const syncClock = () => {
      const duration = resolveDuration(media);
      const time = clamp(media.currentTime, 0, duration);
      playheadAnchorRef.current = { time, perf: performance.now() };
      if (!dragActiveRef.current) syncDisplay(time, duration, true);
    };
    const stopFrames = () => {
      if (rafRef.current == null) return;
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    const tick = (now: number) => {
      rafRef.current = null;
      if (!canAnimate()) return;
      if (!dragActiveRef.current) {
        // Smooth the playhead between decoder updates, only while playing.
        const duration = resolveDuration(media);
        const raw = clamp(media.currentTime, 0, duration);
        const anchor = playheadAnchorRef.current;
        const rate = media.playbackRate > 0 ? media.playbackRate : 1;
        const projected = clamp(anchor.time + ((now - anchor.perf) / 1000) * rate, 0, duration);
        if (Math.abs(raw - projected) > DECODER_DRIFT_THRESHOLD || raw > projected) {
          playheadAnchorRef.current = { time: raw, perf: now };
          syncDisplay(raw, duration);
        } else {
          syncDisplay(projected, duration);
        }
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    const startFrames = () => {
      syncClock();
      if (rafRef.current == null && canAnimate()) rafRef.current = window.requestAnimationFrame(tick);
    };
    const settle = () => {
      stopFrames();
      syncClock();
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    // Update from media events while paused, loading or hidden.
    for (const event of ["loadedmetadata", "durationchange", "ratechange"]) {
      media.addEventListener(event, syncClock, { signal });
    }
    for (const event of ["pause", "ended", "waiting", "seeking", "error", "emptied"]) {
      media.addEventListener(event, settle, { signal });
    }
    media.addEventListener("playing", startFrames, { signal });
    media.addEventListener("seeked", startFrames, { signal });
    document.addEventListener("visibilitychange", () => document.hidden ? settle() : startFrames(), { signal });
    startFrames();
    return () => {
      listeners.abort();
      stopFrames();
    };
  }, [mediaKey, mediaRef, open]);

  useEffect(() => {
    if (!open) {
      dragActiveRef.current = false;
      dragPointerIdRef.current = null;
      previewTimeRef.current = null;
      setDraggingIfChanged(false);
    }
  }, [open]);

  useEffect(() => {
    const cancelDragOnBlur = () => {
      dragActiveRef.current = false;
      dragPointerIdRef.current = null;
      previewTimeRef.current = null;
      setDraggingIfChanged(false);
    };

    window.addEventListener("blur", cancelDragOnBlur);
    return () => window.removeEventListener("blur", cancelDragOnBlur);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const duration = durationRef.current;
    if (duration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragActiveRef.current = true;
    dragPointerIdRef.current = event.pointerId;
    setDraggingIfChanged(true);
    const target = resolveTimeFromPointer(event.clientX);
    previewTimeRef.current = target;
    syncDisplay(target, duration, true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragActiveRef.current) return;
    if (dragPointerIdRef.current !== event.pointerId) return;
    const duration = durationRef.current;
    if (duration <= 0) return;
    const target = resolveTimeFromPointer(event.clientX);
    previewTimeRef.current = target;
    syncDisplay(target, duration);
  };

  const releaseDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    shouldCommit: boolean,
  ) => {
    if (!dragActiveRef.current) return;
    if (dragPointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragActiveRef.current = false;
    dragPointerIdRef.current = null;
    setDraggingIfChanged(false);
    const target = previewTimeRef.current;
    previewTimeRef.current = null;
    if (!shouldCommit || target == null) return;
    commitSeek(target);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    releaseDrag(event, true);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    releaseDrag(event, false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const duration = durationRef.current;
    if (duration <= 0) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    event.stopPropagation();

    const current = displayRef.current;
    const delta = event.key === "ArrowLeft" ? -SHIFT_ARROW_STEP_SECONDS : SHIFT_ARROW_STEP_SECONDS;
    commitSeek(current + delta);
  };

  const seekDisabled = disabled || labels.max <= 0;
  const ariaValueText = `${labels.current} elapsed, ${labels.remaining} remaining`;

  return (
    <div className="quick-preview-timeline-shell">
      <div className="quick-preview-control-time quick-preview-control-time-current">
        {labels.current}
      </div>
      <div
        className={`quick-preview-timeline${dragging ? " is-dragging" : ""}${seekDisabled ? " is-disabled" : ""}`}
        ref={rootRef}
        role="slider"
        aria-label="Playback position"
        aria-disabled={seekDisabled || undefined}
        aria-valuemin={0}
        aria-valuemax={seekDisabled ? 0 : labels.max}
        aria-valuenow={seekDisabled ? 0 : labels.now}
        aria-valuetext={ariaValueText}
        tabIndex={seekDisabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
      >
        <div className="quick-preview-timeline-rail" aria-hidden="true" />
        <div className="quick-preview-playhead" aria-hidden="true" />
      </div>
      <div className="quick-preview-control-time quick-preview-control-time-remaining">
        -{labels.remaining}
      </div>
    </div>
  );
};
