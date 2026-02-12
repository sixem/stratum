// Custom video timeline for preview mode.
// Uses direct CSS variable updates for smooth playhead motion without per-frame React renders.
import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

type QuickPreviewTimelineProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
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

const resolveDuration = (video: HTMLVideoElement | null) => {
  if (!video) return 0;
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return duration;
};

export const QuickPreviewTimeline = ({
  videoRef,
  open,
  disabled,
  onCommitSeek,
}: QuickPreviewTimelineProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
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

  const writeProgress = (time: number, duration: number) => {
    const root = rootRef.current;
    if (!root) return;
    const progress = duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0;
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
    setLabels({
      current: formatMediaTime(clampedTime),
      remaining: formatMediaTime(Math.max(0, clampedDuration - clampedTime)),
      now: clampedTime,
      max: clampedDuration,
    });
  };

  const commitSeek = (time: number) => {
    const video = videoRef.current;
    const duration = resolveDuration(video);
    if (!video || duration <= 0) return;
    const target = clamp(time, 0, duration);
    if (typeof video.fastSeek === "function") {
      try {
        video.fastSeek(target);
      } catch {
        video.currentTime = target;
      }
    } else {
      video.currentTime = target;
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
    if (!open) {
      playheadAnchorRef.current = { time: 0, perf: 0 };
      syncDisplay(0, 0, true);
      return;
    }

    const tick = () => {
      const video = videoRef.current;
      if (!video) {
        playheadAnchorRef.current = { time: 0, perf: performance.now() };
        syncDisplay(0, 0);
        rafRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const now = performance.now();
      const duration = resolveDuration(video);
      if (dragActiveRef.current) {
        syncDisplay(previewTimeRef.current ?? 0, duration);
      } else if (duration <= 0) {
        playheadAnchorRef.current = { time: 0, perf: now };
        syncDisplay(0, 0);
      } else if (video.paused || video.ended) {
        const raw = clamp(video.currentTime, 0, duration);
        playheadAnchorRef.current = { time: raw, perf: now };
        syncDisplay(raw, duration);
      } else {
        // The webview can report currentTime in coarse steps. We anchor to the latest
        // decoder time and interpolate between samples so the playhead glides smoothly.
        const rate = Number.isFinite(video.playbackRate) ? video.playbackRate : 1;
        const safeRate = rate > 0 ? rate : 1;
        const raw = clamp(video.currentTime, 0, duration);
        const anchor = playheadAnchorRef.current;

        if (anchor.perf === 0) {
          playheadAnchorRef.current = { time: raw, perf: now };
          syncDisplay(raw, duration);
        } else {
          const projected = clamp(
            anchor.time + ((now - anchor.perf) / 1000) * safeRate,
            0,
            duration,
          );
          const drift = Math.abs(raw - projected);
          if (drift > DECODER_DRIFT_THRESHOLD || raw > projected) {
            playheadAnchorRef.current = { time: raw, perf: now };
            syncDisplay(raw, duration);
          } else {
            syncDisplay(projected, duration);
          }
        }
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [open, videoRef]);

  useEffect(() => {
    if (!open) {
      dragActiveRef.current = false;
      dragPointerIdRef.current = null;
      previewTimeRef.current = null;
      setDragging(false);
    }
  }, [open]);

  useEffect(() => {
    const cancelDragOnBlur = () => {
      dragActiveRef.current = false;
      dragPointerIdRef.current = null;
      previewTimeRef.current = null;
      setDragging(false);
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
    setDragging(true);
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
    setDragging(false);
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
        aria-label="Video timeline"
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
        <div className="quick-preview-timeline-fill" aria-hidden="true" />
        <div className="quick-preview-timeline-thumb" aria-hidden="true" />
      </div>
      <div className="quick-preview-control-time quick-preview-control-time-remaining">
        -{labels.remaining}
      </div>
    </div>
  );
};
