// Manages thumbnail requests and caches by view settings.
import { listen } from "@tauri-apps/api/event";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestThumbnails, toThumbnailUrl } from "@/api";
import { makeDebug } from "@/lib";
import type { ThumbnailEvent, ThumbnailRequest, ThumbnailRequestOptions } from "@/types";

const buildOptionsKey = (options: ThumbnailRequestOptions) => {
  const quality = options.format === "jpeg" ? options.quality : "lossless";
  const videoFlag = options.allowVideos ? "video" : "no-video";
  const svgFlag = options.allowSvgs ? "svg" : "no-svg";
  return [options.size, options.format, quality, videoFlag, svgFlag].join(":");
};

// Include metadata so edits invalidate cache even when the path stays the same.
const buildSignature = (request: ThumbnailRequest, optionsKey: string) => {
  const size = request.size ?? "none";
  const modified = request.modified ?? "none";
  return `${optionsKey}:${request.path}:${size}:${modified}`;
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
      signature: request.signature,
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
      signature: next.signature ?? existing.signature,
    });
  });
  return merged;
};

// Normalize keys so path casing/separators do not churn thumbnail lookups.
export const useThumbnails = (
  options: ThumbnailRequestOptions,
  enabled: boolean,
  resetKey?: string,
) => {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const pending = useRef(new Set<string>());
  // Keep the last signature we rendered so edits invalidate cached thumbs.
  const signatureByPathRef = useRef<Map<string, string>>(new Map());
  // Store signatures for in-flight requests so events can commit the right key.
  const pendingSignaturesRef = useRef<Map<string, string>>(new Map());
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
    signatureByPathRef.current.clear();
    pendingSignaturesRef.current.clear();
    pendingUpdatesRef.current.clear();
    clearFlushTimer();
    setThumbnails(new Map());
  }, [clearFlushTimer, optionsKey]);

  useEffect(() => {
    if (resetKey === undefined) return;
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    pending.current.clear();
    signatureByPathRef.current.clear();
    pendingSignaturesRef.current.clear();
    pendingUpdatesRef.current.clear();
    clearFlushTimer();
    setThumbnails(new Map());
  }, [clearFlushTimer, resetKey]);

  useEffect(() => {
    return () => {
      pendingUpdatesRef.current.clear();
      pendingSignaturesRef.current.clear();
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
        const signature =
          payload.signature ?? pendingSignaturesRef.current.get(payload.path);
        if (signature) {
          signatureByPathRef.current.set(payload.path, signature);
          pendingSignaturesRef.current.delete(payload.path);
        }
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
      const requestSignatures = new Map<string, string>();
      const missing = Array.from(deduped.values()).filter(
        (request) => {
          const signature =
            request.signature ?? buildSignature(request, optionsKeyRef.current);
          requestSignatures.set(request.path, signature);
          const currentSignature = signatureByPathRef.current.get(request.path);
          const hasThumb = thumbnailsRef.current.has(request.path);
          const isFresh = hasThumb && currentSignature === signature;
          return !isFresh && !pending.current.has(request.path);
        },
      );
      if (missing.length === 0) return;
      const batch = missing.slice(0, 120).map((request) => ({
        ...request,
        signature: requestSignatures.get(request.path),
      }));
      batch.forEach((request) => {
        pending.current.add(request.path);
        const signature = request.signature ?? requestSignatures.get(request.path);
        if (signature) {
          pendingSignaturesRef.current.set(request.path, signature);
        }
      });
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
        hits.forEach((hit) => {
          const signature = hit.signature ?? requestSignatures.get(hit.path);
          if (signature) {
            signatureByPathRef.current.set(hit.path, signature);
            pendingSignaturesRef.current.delete(hit.path);
          }
        });
        startTransition(() => {
          setThumbnails((prev) => {
            const next = new Map(prev);
            hits.forEach((hit) => next.set(hit.path, toThumbnailUrl(hit.thumbPath)));
            return next;
          });
        });
      } catch {
        // Ignore thumbnail request errors; entries will retry on next view update.
        batch.forEach((request) => pendingSignaturesRef.current.delete(request.path));
      } finally {
        batch.forEach((request) => pending.current.delete(request.path));
      }
    },
    [enabled, options],
  );

  return { thumbnails, requestThumbnails: request, optionsKey };
};
