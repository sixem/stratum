// Manages thumbnail requests and caches by view settings.
import { listen } from "@tauri-apps/api/event";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestThumbnails, toThumbnailUrl } from "@/api";
import { makeDebug } from "@/lib";
import type { ThumbnailEvent, ThumbnailRequest, ThumbnailRequestOptions } from "@/types";

const buildOptionsKey = (options: ThumbnailRequestOptions) => {
  const quality = options.format === "jpeg" ? options.quality : "lossless";
  const videoFlag = options.allowVideos ? "video" : "no-video";
  return [options.size, options.format, quality, videoFlag].join(":");
};

// Batch thumbnail ready events to avoid re-rendering for every single image.
const THUMB_EVENT_FLUSH_MS = 80;
const perf = makeDebug("perf:thumbs");

// Deduplicate thumbnail requests by path while preserving any known metadata.
const normalizeRequests = (requests: ThumbnailRequest[]) => {
  const merged = new Map<string, ThumbnailRequest>();
  requests.forEach((request) => {
    const trimmed = request.path.trim();
    if (!trimmed) return;
    const next: ThumbnailRequest = {
      path: trimmed,
      size: request.size ?? null,
      modified: request.modified ?? null,
    };
    const existing = merged.get(trimmed);
    if (!existing) {
      merged.set(trimmed, next);
      return;
    }
    merged.set(trimmed, {
      path: trimmed,
      size: next.size ?? existing.size ?? null,
      modified: next.modified ?? existing.modified ?? null,
    });
  });
  return merged;
};

export const useThumbnails = (
  options: ThumbnailRequestOptions,
  enabled: boolean,
  resetKey?: string,
) => {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const pending = useRef(new Set<string>());
  const pendingUpdatesRef = useRef(new Map<string, string>());
  const flushTimerRef = useRef<number | null>(null);
  const thumbnailsRef = useRef(thumbnails);
  const optionsKey = useMemo(() => buildOptionsKey(options), [options]);
  const optionsKeyRef = useRef(optionsKey);
  const flushKeyRef = useRef(optionsKey);
  const resetKeyRef = useRef(resetKey);

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushPendingUpdates = useCallback(() => {
    if (flushKeyRef.current !== optionsKeyRef.current) {
      pendingUpdatesRef.current.clear();
      return;
    }
    if (pendingUpdatesRef.current.size === 0) return;
    const updates = new Map(pendingUpdatesRef.current);
    pendingUpdatesRef.current.clear();
    startTransition(() => {
      setThumbnails((prev) => {
        let changed = false;
        const next = new Map(prev);
        updates.forEach((url, path) => {
          if (next.get(path) === url) return;
          next.set(path, url);
          changed = true;
        });
        return changed ? next : prev;
      });
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;
    flushKeyRef.current = optionsKeyRef.current;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushPendingUpdates();
    }, THUMB_EVENT_FLUSH_MS);
  }, [flushPendingUpdates]);

  useEffect(() => {
    thumbnailsRef.current = thumbnails;
  }, [thumbnails]);

  useEffect(() => {
    if (optionsKeyRef.current === optionsKey) return;
    optionsKeyRef.current = optionsKey;
    pending.current.clear();
    pendingUpdatesRef.current.clear();
    clearFlushTimer();
    setThumbnails(new Map());
  }, [clearFlushTimer, optionsKey]);

  useEffect(() => {
    if (resetKey === undefined) return;
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    pending.current.clear();
    pendingUpdatesRef.current.clear();
    clearFlushTimer();
    setThumbnails(new Map());
  }, [clearFlushTimer, resetKey]);

  useEffect(() => {
    return () => {
      pendingUpdatesRef.current.clear();
      clearFlushTimer();
    };
  }, [clearFlushTimer]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let active = true;
    const setup = async () => {
      const stop = await listen<ThumbnailEvent>("thumb_ready", (event) => {
        const payload = event.payload;
        if (!payload || payload.key !== optionsKeyRef.current) return;
        const url = toThumbnailUrl(payload.thumbPath);
        pendingUpdatesRef.current.set(payload.path, url);
        scheduleFlush();
        pending.current.delete(payload.path);
      });
      if (!active) {
        stop();
        return;
      }
      unlisten = stop;
    };
    void setup();
    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const request = useCallback(
    async (requests: ThumbnailRequest[]) => {
      if (!enabled) return;
      const deduped = normalizeRequests(requests);
      const missing = Array.from(deduped.values()).filter(
        (request) =>
          !thumbnailsRef.current.has(request.path) && !pending.current.has(request.path),
      );
      if (missing.length === 0) return;
      const batch = missing.slice(0, 120);
      batch.forEach((request) => pending.current.add(request.path));
      const key = optionsKeyRef.current;
      try {
        const start = perf.enabled ? performance.now() : 0;
        const hits = await requestThumbnails(batch, options, key);
        if (key !== optionsKeyRef.current) return;
        if (hits.length === 0) return;
        if (perf.enabled) {
          perf(
            "thumb request: batch=%d hits=%d in %dms",
            batch.length,
            hits.length,
            Math.round(performance.now() - start),
          );
        }
        startTransition(() => {
          setThumbnails((prev) => {
            const next = new Map(prev);
            hits.forEach((hit) => next.set(hit.path, toThumbnailUrl(hit.thumbPath)));
            return next;
          });
        });
      } catch {
        // Ignore thumbnail request errors; entries will retry on next view update.
      } finally {
        batch.forEach((request) => pending.current.delete(request.path));
      }
    },
    [enabled, options],
  );

  return { thumbnails, requestThumbnails: request, optionsKey };
};
