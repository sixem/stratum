// Opens filesystem paths via the host OS.
import { invoke } from "@tauri-apps/api/core";
import type { OpenWithHandler } from "@/types";

export const openPath = (path: string) => invoke<void>("open_path", { path });

export const openPathProperties = (paths: string[] | string) => {
  const normalized = Array.isArray(paths) ? paths : [paths];
  return invoke<void>("open_path_properties", { paths: normalized });
};

export const listOpenWithHandlers = (path: string) => {
  return invoke<OpenWithHandler[]>("list_open_with_handlers", { path });
};

export const openPathWithHandler = (path: string, handlerId: string) => {
  return invoke<void>("open_path_with_handler", { path, handlerId });
};

export const openPathWithDialog = (path: string) => {
  return invoke<void>("open_path_with_dialog", { path });
};
