import { invoke } from "@tauri-apps/api/core";

export const createPreviewGrant = (path: string) =>
  invoke<string>("create_preview_grant", { path });

export const releasePreviewGrant = (token: string) =>
  invoke<void>("release_preview_grant", { token });
