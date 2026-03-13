// Shared request/response types for backend-managed conversion jobs.
import type { ImageConvertOptions } from "./images";
import type { VideoConvertOptions } from "./videos";

export type ImageConversionJobItem = {
  kind: "image";
  sourcePath: string;
  destinationPath: string;
  deleteSourceAfterSuccess: boolean;
  options: ImageConvertOptions;
};

export type VideoConversionJobItem = {
  kind: "video";
  sourcePath: string;
  destinationPath: string;
  deleteSourceAfterSuccess: boolean;
  options: VideoConvertOptions;
};

export type ConversionJobItem = ImageConversionJobItem | VideoConversionJobItem;

export type ConversionReport = {
  converted: number;
  failed: number;
  failures: string[];
};
