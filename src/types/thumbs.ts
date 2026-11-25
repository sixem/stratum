// Shared thumbnail request/response types.
export type ThumbnailFormat = "webp" | "jpeg";

export type ThumbnailRequest = {
  path: string;
  size: number | null;
  modified: number | null;
  // Optional UI-computed signature echoed back by the backend.
  signature?: string;
  // A displayed cache URL that could not be loaded. This is consumed by the UI.
  failedUrl?: string;
};

export type ThumbnailView = "main" | "bottom" | "gallery";

export type ThumbnailScope = {
  view: ThumbnailView;
  generation: number;
};

export type RequestScopedThumbnails = (
  requests: ThumbnailRequest[],
  scope: ThumbnailScope,
) => void;

export type ThumbnailRequestOptions = {
  size: number;
  quality: number;
  format: ThumbnailFormat;
  allowVideos: boolean;
  allowSvgs: boolean;
  darkSvgPreviews: boolean;
  cacheMb: number;
};

export type ThumbnailHit = {
  path: string;
  thumbPath: string;
  key: string;
  // Signature for cache reconciliation (matches the request when provided).
  signature?: string;
};

export type ThumbnailEvent = ThumbnailHit;

export type ThumbnailLookup = Pick<ReadonlyMap<string, string>, "get" | "has">;
