// Syncs UI interaction state to the thumbnail worker pause flag.
import { useEffect, useRef } from "react";
import { setThumbPaused } from "@/api";

export const useThumbnailPause = (paused: boolean, enabled: boolean) => {
  const lastPausedRef = useRef<boolean | null>(null);

  useEffect(() => {
    const nextPaused = enabled ? paused : false;
    if (lastPausedRef.current === nextPaused) return;
    lastPausedRef.current = nextPaused;
    void setThumbPaused(nextPaused).catch(() => {
      // Ignore pause toggle errors; thumbnail requests will retry.
    });
  }, [enabled, paused]);

  useEffect(() => {
    return () => {
      if (lastPausedRef.current) {
        lastPausedRef.current = false;
        void setThumbPaused(false).catch(() => {
          // Ignore pause reset errors during teardown.
        });
      }
    };
  }, []);
};
