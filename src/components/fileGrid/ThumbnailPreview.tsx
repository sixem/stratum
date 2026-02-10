// Renders a thumbnail image with DOM-driven ready state to avoid React churn.
import type { ThumbnailPreviewProps } from "./gridCard.types";

export const ThumbnailPreview = ({ src }: ThumbnailPreviewProps) => {
  if (!src) return null;

  return (
    <img
      className="thumb-preview"
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="lazy"
      decoding="async"
      data-ready="false"
      onLoad={(event) => {
        event.currentTarget.dataset.ready = "true";
      }}
      onError={(event) => {
        event.currentTarget.dataset.ready = "false";
      }}
    />
  );
};
