// Native icons for file types and individual executables.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { FileIconHit } from "@/types";
import type { ExecutableIconHit } from "@/types/fileIcons";

export const getFileIcons = (extensions: string[]) => {
  return invoke<FileIconHit[]>("get_file_icons", { extensions });
};

export const getExecutableIcons = (paths: string[]) =>
  invoke<ExecutableIconHit[]>("get_executable_icons", { paths });

export const toFileIconUrl = (iconPath: string) => {
  return convertFileSrc(iconPath);
};
