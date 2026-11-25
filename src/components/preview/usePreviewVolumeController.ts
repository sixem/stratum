// Owns the preview volume flyout, timers, and sticky volume persistence.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent } from "react";
import { AUDIO_PREVIEW_VOLUME_KEY, PREVIEW_VOLUME_KEY } from "@/constants/settings";

const VOLUME_AUTO_CLOSE_DELAY_MS = 2000;
const VOLUME_HOVER_OPEN_DELAY_MS = 250;

const clampVolume = (value: number) => {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

// Keep preview volume sticky so the overlay feels consistent between files.
const readPreviewVolume = (key: string) => {
  const fallback = 0.1;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored == null) return fallback;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clampVolume(parsed) : fallback;
  } catch {
    return fallback;
  }
};

type UsePreviewVolumeControllerOptions = {
  previewSessionKey: string;
  isAudio: boolean;
};

export const usePreviewVolumeController = ({
  previewSessionKey,
  isAudio,
}: UsePreviewVolumeControllerOptions) => {
  const sessionKeyRef = useRef("");
  const volumeRangeRef = useRef<HTMLInputElement | null>(null);
  const volumeCloseTimerRef = useRef<number | null>(null);
  const volumeHoverTimerRef = useRef<number | null>(null);
  const volumeAdjustingRef = useRef(false);
  const volumePinnedOpenRef = useRef(false);
  const [videoVolume, setVideoVolume] = useState(() => readPreviewVolume(PREVIEW_VOLUME_KEY));
  const [audioVolume, setAudioVolume] = useState(() => readPreviewVolume(AUDIO_PREVIEW_VOLUME_KEY));
  const [volumePickerOpen, setVolumePickerOpen] = useState(false);

  const clearVolumePickerCloseTimer = useCallback(() => {
    if (volumeCloseTimerRef.current == null) return;
    window.clearTimeout(volumeCloseTimerRef.current);
    volumeCloseTimerRef.current = null;
  }, []);

  const clearVolumeHoverOpenTimer = useCallback(() => {
    if (volumeHoverTimerRef.current == null) return;
    window.clearTimeout(volumeHoverTimerRef.current);
    volumeHoverTimerRef.current = null;
  }, []);

  const scheduleVolumePickerClose = useCallback(
    (delayMs: number = VOLUME_AUTO_CLOSE_DELAY_MS) => {
      if (volumePinnedOpenRef.current) return;
      clearVolumePickerCloseTimer();
      volumeCloseTimerRef.current = window.setTimeout(() => {
        volumeCloseTimerRef.current = null;
        if (document.activeElement === volumeRangeRef.current) return;
        setVolumePickerOpen(false);
      }, delayMs);
    },
    [clearVolumePickerCloseTimer],
  );

  useEffect(() => {
    if (sessionKeyRef.current === previewSessionKey) return;
    sessionKeyRef.current = previewSessionKey;
    clearVolumePickerCloseTimer();
    clearVolumeHoverOpenTimer();
    volumeAdjustingRef.current = false;
    volumePinnedOpenRef.current = false;
    setVolumePickerOpen((prev) => (prev ? false : prev));
  }, [clearVolumeHoverOpenTimer, clearVolumePickerCloseTimer, previewSessionKey]);

  useEffect(() => {
    return () => {
      clearVolumePickerCloseTimer();
      clearVolumeHoverOpenTimer();
    };
  }, [clearVolumeHoverOpenTimer, clearVolumePickerCloseTimer]);

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
  }, [clearVolumePickerCloseTimer, scheduleVolumePickerClose, volumePickerOpen]);

  const persistMediaVolume = useCallback((value: number) => {
    const clamped = clampVolume(value);
    const setVolume = isAudio ? setAudioVolume : setVideoVolume;
    setVolume(clamped);
    try {
      window.localStorage.setItem(isAudio ? AUDIO_PREVIEW_VOLUME_KEY : PREVIEW_VOLUME_KEY, clamped.toString());
    } catch {
      // Ignore persistence failures (private windows, disabled storage).
    }
  }, [isAudio]);

  const handleToggleVolumePicker = useCallback(() => {
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
  }, [clearVolumeHoverOpenTimer, clearVolumePickerCloseTimer]);

  const handleVolumeHoverStart = useCallback(() => {
    clearVolumePickerCloseTimer();
    clearVolumeHoverOpenTimer();
    volumeHoverTimerRef.current = window.setTimeout(() => {
      volumeHoverTimerRef.current = null;
      if (volumePinnedOpenRef.current) return;
      setVolumePickerOpen(true);
    }, VOLUME_HOVER_OPEN_DELAY_MS);
  }, [clearVolumeHoverOpenTimer, clearVolumePickerCloseTimer]);

  const handleVolumeHoverEnd = useCallback(() => {
    clearVolumeHoverOpenTimer();
    if (volumePinnedOpenRef.current) return;
    if (volumeAdjustingRef.current) return;
    scheduleVolumePickerClose(260);
  }, [clearVolumeHoverOpenTimer, scheduleVolumePickerClose]);

  const handleVolumeChange = useCallback(
    (event: ReactChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value);
      persistMediaVolume(Number.isFinite(value) ? value : 1);
      if (volumeAdjustingRef.current) return;
      scheduleVolumePickerClose();
    },
    [persistMediaVolume, scheduleVolumePickerClose],
  );

  const handleVolumePointerDown = useCallback(() => {
    volumeAdjustingRef.current = true;
    clearVolumePickerCloseTimer();
  }, [clearVolumePickerCloseTimer]);

  const handleVolumePointerUp = useCallback(() => {
    volumeAdjustingRef.current = false;
    if (!volumePinnedOpenRef.current) {
      scheduleVolumePickerClose();
    }
  }, [scheduleVolumePickerClose]);

  return {
    mediaVolume: isAudio ? audioVolume : videoVolume,
    volumePickerOpen,
    volumeRangeRef,
    handleToggleVolumePicker,
    handleVolumeHoverStart,
    handleVolumeHoverEnd,
    handleVolumeChange,
    handleVolumePointerDown,
    handleVolumePointerUp,
    scheduleVolumePickerClose,
  };
};
