// Share native icon lookups across panes and distinguish a pending request from a miss.
import { useEffect, useMemo, useReducer } from "react";
import { getExecutableIcons, getFileIcons, toFileIconUrl } from "@/api/fileIcons";
import type { ThumbnailRequest } from "@/types";

const CACHE_LIMIT = 512;
const RETRY_DELAY_MS = 15_000;

type IconRequest = { id: string; key: string };
type CachedIcon = { url: string | null; retryAt: number };
type FetchIcons = (ids: string[]) => Promise<Map<string, string>>;

const makeLookup = (batchSize: number, fetchIcons: FetchIcons) => ({
  batchSize,
  fetchIcons,
  icons: new Map<string, CachedIcon>(),
  pending: new Map<string, Promise<void>>(),
});

const extensionLookup = makeLookup(80, async extensions => new Map(
  (await getFileIcons(extensions)).map(({ extension, iconPath }) => [extension, toFileIconUrl(iconPath)]),
));
const executableLookup = makeLookup(24, async paths => new Map(
  (await getExecutableIcons(paths)).map(({ path, iconPath }) => [path, toFileIconUrl(iconPath)]),
));

type IconLookup = ReturnType<typeof makeLookup>;

const recordIcon = (icons: IconLookup["icons"], key: string, url: string | null) => {
  icons.delete(key);
  icons.set(key, { url, retryAt: url ? Infinity : Date.now() + RETRY_DELAY_MS });
  while (icons.size > CACHE_LIMIT) {
    const oldest = icons.keys().next().value;
    if (oldest === undefined) break;
    icons.delete(oldest);
  }
};

const loadBatch = ({ icons, pending, fetchIcons }: IconLookup, batch: IconRequest[]) => {
  const work = new Set<Promise<void>>();
  const now = Date.now();
  const needed = batch.filter(({ key }) => {
    const inFlight = pending.get(key);
    if (inFlight) work.add(inFlight);
    return !inFlight && (icons.get(key)?.retryAt ?? 0) <= now;
  });
  if (needed.length) {
    const load = fetchIcons(needed.map(({ id }) => id))
      .catch(() => new Map<string, string>())
      .then(hits => {
        for (const { key, id } of needed) {
          recordIcon(icons, key, hits.get(id) ?? null);
          pending.delete(key);
        }
      });
    needed.forEach(({ key }) => pending.set(key, load));
    work.add(load);
  }
  return work.size ? Promise.all(work) : null;
};

const useIconLookup = (lookup: IconLookup, requests: IconRequest[], canRequest: boolean) => {
  const [revision, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => {
    if (!canRequest) return;
    let active = true;
    const loadVisible = async () => {
      for (let start = 0; active && start < requests.length; start += lookup.batchSize) {
        const work = loadBatch(lookup, requests.slice(start, start + lookup.batchSize));
        if (!work) continue;
        await work;
        if (active) refresh();
      }
    };
    void loadVisible();
    return () => { active = false; };
  }, [lookup, canRequest, requests]);

  // Read the cache again when requests resume after scrolling or resizing.
  return useMemo(() => {
    const visible = new Map<string, string | null>();
    for (const { id, key } of requests) {
      const match = lookup.icons.get(key);
      if (match) visible.set(id, match.url);
    }
    return visible;
  }, [lookup, canRequest, requests, revision]);
};

export const useFileIcons = (extensions: string[], executables: ThumbnailRequest[], canRequest: boolean) => {
  const typeRequests = useMemo(() => extensions.map(extension => ({ id: extension, key: extension })), [extensions]);
  const exeRequests = useMemo(() => executables.map(({ path, size, modified }) => ({
    id: path, key: JSON.stringify([path, size, modified]),
  })), [executables]);
  return {
    fileIcons: useIconLookup(extensionLookup, typeRequests, canRequest),
    executableIcons: useIconLookup(executableLookup, exeRequests, canRequest),
  };
};
