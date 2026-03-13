// Image metadata helpers.
import { invoke } from "@tauri-apps/api/core";
import type { ImageInfo } from "@/types";

export const getImageInfo = (path: string) => {
  return invoke<ImageInfo>("get_image_info", { path });
};
