// Opens filesystem paths via the host OS.
import { invoke } from "@tauri-apps/api/core";

export function openPath(path: string) {
  return invoke<void>("open_path", { path });
}

export function openPathProperties(path: string) {
  return invoke<void>("open_path_properties", { path });
}
