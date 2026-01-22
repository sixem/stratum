// Shared thumbnail request/response types.
export type ThumbnailFormat = "webp" | "jpeg";

export type ThumbnailRequest = {
  path: string;
  size: number | null;
  modified: number | null;
};

export type ThumbnailRequestOptions = {
  size: number;
  quality: number;
  format: ThumbnailFormat;
  allowVideos: boolean;
  cacheMb: number;
};

export type ThumbnailHit = {
  path: string;
  thumbPath: string;
  key: string;
};

export type ThumbnailEvent = ThumbnailHit;
