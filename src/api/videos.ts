// Video conversion helper backed by ffmpeg on the Tauri side.
import { invoke } from "@tauri-apps/api/core";
import type { VideoConvertOptions } from "@/types";

export const convertVideo = (
  path: string,
  destination: string,
  options: VideoConvertOptions,
) => {
  return invoke<void>("convert_video", { path, destination, options });
};
