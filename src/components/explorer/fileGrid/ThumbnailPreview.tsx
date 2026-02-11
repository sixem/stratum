// Renders a thumbnail image with DOM-driven ready state to avoid React churn.
import type { ThumbnailPreviewProps } from "./gridCard.types";

const THUMB_READY_CACHE_LIMIT = 4000;
// Keep recently loaded thumb URLs so tab/view remounts can display instantly.
const readyThumbSrcCache = new Set<string>();

const markThumbReady = (src: string) => {
  if (!src) return;
  if (readyThumbSrcCache.has(src)) return;
  readyThumbSrcCache.add(src);
  if (readyThumbSrcCache.size <= THUMB_READY_CACHE_LIMIT) return;
  const oldest = readyThumbSrcCache.values().next().value as string | undefined;
  if (!oldest) return;
  readyThumbSrcCache.delete(oldest);
};

export const ThumbnailPreview = ({ src }: ThumbnailPreviewProps) => {
  if (!src) return null;
  const isKnownReady = readyThumbSrcCache.has(src);

  return (
    <img
      className="thumb-preview"
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="lazy"
      decoding="async"
      data-ready={isKnownReady ? "true" : "false"}
      onLoad={(event) => {
        markThumbReady(src);
        event.currentTarget.dataset.ready = "true";
      }}
      onError={(event) => {
        event.currentTarget.dataset.ready = "false";
      }}
    />
  );
};
