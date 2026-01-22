export type ThumbnailFormat = "webp" | "jpeg";

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
