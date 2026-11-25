// Thumbnail generation and cache access helpers.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  ThumbnailHit, ThumbnailRequest, ThumbnailRequestOptions, ThumbnailScope, ThumbnailView,
} from "@/types";

export const requestThumbnails = (
  requests: ThumbnailRequest[],
  options: ThumbnailRequestOptions,
  key: string,
  scope: ThumbnailScope,
) => {
  return invoke<ThumbnailHit[]>("request_thumbnails", { requests, options, key, scope });
};

export const openThumbnailScope = (view: ThumbnailView) => {
  return invoke<ThumbnailScope>("open_thumbnail_scope", { view });
};

export const closeThumbnailScope = (scope: ThumbnailScope) => {
  return invoke<void>("close_thumbnail_scope", { scope });
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
