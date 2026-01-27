// Default app icon retrieval for file extensions.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { FileIconHit } from "@/types";

export const getFileIcons = (extensions: string[]) => {
  return invoke<FileIconHit[]>("get_file_icons", { extensions });
};

export const toFileIconUrl = (iconPath: string) => {
  return convertFileSrc(iconPath);
};
