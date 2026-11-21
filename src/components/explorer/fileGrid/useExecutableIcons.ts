// Load per-file icons in small batches and share completed and pending work across panes.
import { useEffect, useMemo, useReducer } from "react";
import { getExecutableIcons, toFileIconUrl } from "@/api/fileIcons";
import type { ThumbnailRequest } from "@/types";

const MAX_BATCH = 24;
const CACHE_LIMIT = 512;
const RETRY_DELAY_MS = 15_000;

type IconRequest = { path: string; key: string };
type CachedIcon = { url: string | undefined; retryAt: number };

const icons = new Map<string, CachedIcon>();
const pending = new Map<string, Promise<void>>();

const recordIcon = (key: string, url?: string) => {
  icons.delete(key);
  icons.set(key, { url, retryAt: url ? Infinity : Date.now() + RETRY_DELAY_MS });
  while (icons.size > CACHE_LIMIT) {
    const oldest = icons.keys().next().value;
    if (oldest === undefined) break;
    icons.delete(oldest);
  }
};

const loadBatch = (batch: IconRequest[]) => {
  const work = new Set<Promise<void>>();
  const needed = batch.filter(({ key }) => {
    const inFlight = pending.get(key);
    if (inFlight) work.add(inFlight);
    return !inFlight && (icons.get(key)?.retryAt ?? 0) <= Date.now();
  });
  if (needed.length) {
    const load = getExecutableIcons(needed.map(({ path }) => path))
      .then(hits => new Map(hits.map(hit => [hit.path, toFileIconUrl(hit.iconPath)])))
      // A temporary cache or shell failure leaves the normal type icon in place.
      .catch(() => new Map<string, string>())
      .then(hits => {
        for (const { key, path } of needed) {
          recordIcon(key, hits.get(path));
          pending.delete(key);
        }
      });
    needed.forEach(({ key }) => pending.set(key, load));
    work.add(load);
  }
  return work.size ? Promise.all(work) : null;
};

export const useExecutableIcons = (files: ThumbnailRequest[], canRequest: boolean) => {
  const [revision, refresh] = useReducer(value => value + 1, 0);
  const requests = useMemo(() => files.map(({ path, size, modified }) => ({
    path, key: JSON.stringify([path, size, modified]),
  })), [files]);

  useEffect(() => {
    if (!canRequest) return;
    let active = true;
    const loadVisible = async () => {
      for (let start = 0; active && start < requests.length; start += MAX_BATCH) {
        const work = loadBatch(requests.slice(start, start + MAX_BATCH));
        if (!work) continue;
        await work;
        if (active) refresh();
      }
    };
    void loadVisible();
    return () => { active = false; };
  }, [canRequest, requests]);

  return useMemo(() => {
    const visible = new Map<string, string>();
    for (const { path, key } of requests) {
      const url = icons.get(key)?.url;
      if (url) visible.set(path, url);
    }
    return visible;
  }, [canRequest, requests, revision]);
};
