// Persists scroll positions for tabs and view modes.
import { useCallback, useEffect, useRef } from "react";
import { makeDebug } from "@/lib";
import { useSessionStore } from "@/modules";

type UseScrollPositionsOptions = {
  maxEntries?: number;
  persistDelayMs?: number;
};

const DEFAULT_MAX_ENTRIES = 160;
const DEFAULT_PERSIST_DELAY = 800;
const log = makeDebug("scroll:store");

export const useScrollPositions = ({
  maxEntries = DEFAULT_MAX_ENTRIES,
  persistDelayMs = DEFAULT_PERSIST_DELAY,
}: UseScrollPositionsOptions = {}) => {
  const positionsRef = useRef<Map<string, number> | null>(null);
  if (!positionsRef.current) {
    const stored = useSessionStore.getState().scrollPositions;
    positionsRef.current = new Map(Object.entries(stored ?? {}));
  }
  const persistTimerRef = useRef<number | null>(null);

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current != null) return;
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      const snapshot = Object.fromEntries(positionsRef.current ?? []);
      useSessionStore.getState().setScrollPositions(snapshot);
    }, persistDelayMs);
  }, [persistDelayMs]);

  const getScrollTop = useCallback((key: string) => {
    return positionsRef.current?.get(key) ?? 0;
  }, []);

  const setScrollTop = useCallback(
    (key: string, scrollTop: number) => {
      const map = positionsRef.current;
      if (!map) return;
      const nextTop = Math.max(0, Math.round(scrollTop));
      if (map.has(key)) {
        map.delete(key);
      }
      map.set(key, nextTop);
      if (log.enabled) {
        log("save: key=%s top=%d size=%d", key, nextTop, map.size);
      }
      if (map.size > maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest) {
          map.delete(oldest);
          if (log.enabled) {
            log("evict: key=%s size=%d", oldest, map.size);
          }
        }
      }
      schedulePersist();
    },
    [maxEntries, schedulePersist],
  );

  useEffect(() => {
    return () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      const snapshot = Object.fromEntries(positionsRef.current ?? []);
      useSessionStore.getState().setScrollPositions(snapshot);
    };
  }, []);

  return { getScrollTop, setScrollTop };
};
