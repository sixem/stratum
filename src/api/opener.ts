// Opens filesystem paths via the host OS.
import { invoke } from "@tauri-apps/api/core";

export const openPath = (path: string) => invoke<void>("open_path", { path });

export const openPathProperties = (path: string) =>
  invoke<void>("open_path_properties", { path });
