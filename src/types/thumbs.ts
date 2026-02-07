// Shared thumbnail request/response types.
export type ThumbnailFormat = "webp" | "jpeg";

export type ThumbnailRequest = {
  path: string;
  size: number | null;
  modified: number | null;
  // Optional UI-computed signature echoed back by the backend.
  signature?: string;
};

export type ThumbnailRequestOptions = {
  size: number;
  quality: number;
  format: ThumbnailFormat;
  allowVideos: boolean;
  allowSvgs: boolean;
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
