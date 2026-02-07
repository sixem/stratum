// Build preview URLs served by the custom Tauri protocol.
// Keep this scheme in sync with src-tauri/src/services/preview_protocol.rs.
import { convertFileSrc } from "@tauri-apps/api/core";

const PREVIEW_PROTOCOL = "stratum-preview";

export const buildPreviewUrl = (path: string) => {
  if (!path) return "";
  return convertFileSrc(path, PREVIEW_PROTOCOL);
};
