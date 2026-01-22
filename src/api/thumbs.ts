// Thumbnail generation and cache access helpers.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { ThumbnailHit, ThumbnailRequest, ThumbnailRequestOptions } from "@/types";

export const requestThumbnails = (
  requests: ThumbnailRequest[],
  options: ThumbnailRequestOptions,
  key: string,
) => {
  return invoke<ThumbnailHit[]>("request_thumbnails", { requests, options, key });
};

export const getThumbCacheDir = () => {
  return invoke<string>("get_thumb_cache_dir");
};

export const clearThumbCache = () => {
  return invoke<void>("clear_thumb_cache");
};

export const getThumbCacheSize = () => {
  return invoke<number>("get_thumb_cache_size");
};

export const setThumbPaused = (paused: boolean) => {
  return invoke<void>("set_thumb_paused", { paused });
};

export const toThumbnailUrl = (thumbPath: string) => {
  return convertFileSrc(thumbPath);
};
