// Shared image metadata + conversion types.
export type ImageInfo = {
  path: string;
  width: number;
  height: number;
  format: string | null;
};

export type ImageTargetFormat = "jpeg" | "png" | "webp" | "bmp" | "gif" | "tiff" | "ico";

export type ImageConvertOptions = {
  format: ImageTargetFormat;
  quality?: number | null;
  overwrite?: boolean | null;
};
