// Manages thumbnail requests and caches by view settings.
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestThumbnails, toThumbnailUrl } from "@/api";
import type { ThumbnailEvent, ThumbnailRequestOptions } from "@/types";

const buildOptionsKey = (options: ThumbnailRequestOptions) => {
  const quality = options.format === "jpeg" ? options.quality : "lossless";
  const videoFlag = options.allowVideos ? "video" : "no-video";
  return [options.size, options.format, quality, videoFlag].join(":");
};

export const useThumbnails = (
  options: ThumbnailRequestOptions,
  enabled: boolean,
  resetKey?: string,
) => {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const pending = useRef(new Set<string>());
  const thumbnailsRef = useRef(thumbnails);
  const optionsKey = useMemo(() => buildOptionsKey(options), [options]);
  const optionsKeyRef = useRef(optionsKey);
  const resetKeyRef = useRef(resetKey);

  useEffect(() => {
    thumbnailsRef.current = thumbnails;
  }, [thumbnails]);

  useEffect(() => {
    if (optionsKeyRef.current === optionsKey) return;
    optionsKeyRef.current = optionsKey;
    pending.current.clear();
    setThumbnails(new Map());
  }, [optionsKey]);

  useEffect(() => {
    if (resetKey === undefined) return;
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    pending.current.clear();
    setThumbnails(new Map());
  }, [resetKey]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let active = true;
    const setup = async () => {
      const stop = await listen<ThumbnailEvent>("thumb_ready", (event) => {
        const payload = event.payload;
        if (!payload || payload.key !== optionsKeyRef.current) return;
        const url = toThumbnailUrl(payload.thumbPath);
        setThumbnails((prev) => {
          if (prev.get(payload.path) === url) return prev;
          const next = new Map(prev);
          next.set(payload.path, url);
          return next;
        });
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
    async (paths: string[]) => {
      if (!enabled) return;
      const unique = new Set(paths.map((path) => path.trim()).filter(Boolean));
      const missing = Array.from(unique).filter(
        (path) => !thumbnailsRef.current.has(path) && !pending.current.has(path),
      );
      if (missing.length === 0) return;
      const batch = missing.slice(0, 120);
      batch.forEach((path) => pending.current.add(path));
      const key = optionsKeyRef.current;
      try {
        const hits = await requestThumbnails(batch, options, key);
        if (key !== optionsKeyRef.current) return;
        if (hits.length === 0) return;
        setThumbnails((prev) => {
          const next = new Map(prev);
          hits.forEach((hit) => next.set(hit.path, toThumbnailUrl(hit.thumbPath)));
          return next;
        });
      } catch {
        // Ignore thumbnail request errors; entries will retry on next view update.
      } finally {
        batch.forEach((path) => pending.current.delete(path));
      }
    },
    [enabled, options],
  );

  return { thumbnails, requestThumbnails: request, optionsKey };
};
