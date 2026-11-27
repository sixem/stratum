// Share small previews across tabs for the lifetime of an SSH session.
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/modules/settings.store";
import type { RemoteEntry } from "./remoteDirectory";
import { requestRemoteVideoThumbnail } from "./remoteVideoThumbnail";

const MAX_ENTRIES = 256;
const MAX_BYTES = 16 * 1024 * 1024;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
let cacheBytes = 0;
let generation = 0;
export const remoteThumbnailGeneration = () => generation;
export const REMOTE_THUMBNAILS_CLEARED = "stratum-remote-thumbnails-cleared";
export const REMOTE_THUMBNAIL_UPDATED = "stratum-remote-thumbnail-updated";

export function clearRemoteThumbnailMemory() {
  generation++;
  cache.clear();
  cacheBytes = 0;
  pending.clear();
  window.dispatchEvent(new Event(REMOTE_THUMBNAILS_CLEARED));
}

const keyFor = (profileId: string, sessionId: number, entry: RemoteEntry) =>
  JSON.stringify([profileId, sessionId, entry.path, entry.size, entry.modified]);

export function getRemoteThumbnail(profileId: string, sessionId: number, entry: RemoteEntry) {
  if (entry.size === null || entry.modified === null) return undefined;
  const key = keyFor(profileId, sessionId, entry);
  const image = cache.get(key);
  if (image) {
    cache.delete(key);
    cache.set(key, image);
  }
  return image;
}

export function requestRemoteThumbnail(profileId: string, sessionId: number, entry: RemoteEntry, videoSignal?: AbortSignal) {
  const cached = getRemoteThumbnail(profileId, sessionId, entry);
  if (cached) return Promise.resolve(cached);
  const key = keyFor(profileId, sessionId, entry);
  const existing = videoSignal ? undefined : pending.get(key);
  if (existing) return existing;
  const requestGeneration = generation;
  const request = (videoSignal ? requestRemoteVideoThumbnail(profileId, sessionId, entry, videoSignal) : invoke<string | null>("remote_thumbnail", { profileId, sessionId, path: entry.path, cacheMb: useSettingsStore.getState().thumbnailCacheMb }))
    .then(image => {
      if (generation !== requestGeneration || !image || !/^data:image\/webp;base64,/.test(image)) return null;
      // Missing metadata cannot reliably identify an unchanged remote file.
      if (generation === requestGeneration && entry.size !== null && entry.modified !== null && image.length <= MAX_BYTES) {
        const previous = cache.get(key);
        if (previous) cacheBytes -= previous.length;
        cache.set(key, image);
        cacheBytes += image.length;
        while (cache.size > MAX_ENTRIES || cacheBytes > MAX_BYTES) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cacheBytes -= cache.get(oldest)!.length;
          cache.delete(oldest);
        }
      }
      return image;
    }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
  if (!videoSignal) pending.set(key, request);
  return request;
}
