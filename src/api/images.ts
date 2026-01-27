// Image metadata and conversion helpers.
import { invoke } from "@tauri-apps/api/core";
import type { ImageConvertOptions, ImageInfo } from "@/types";

export const getImageInfo = (path: string) => {
  return invoke<ImageInfo>("get_image_info", { path });
};

export const convertImage = (
  path: string,
  destination: string,
  options: ImageConvertOptions,
) => {
  return invoke<void>("convert_image", { path, destination, options });
};
