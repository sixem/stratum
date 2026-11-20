// Build a media URL from an authorized preview token.
// Keep this scheme in sync with src-tauri/src/services/preview_protocol.rs.
import { convertFileSrc } from "@tauri-apps/api/core";

const PREVIEW_PROTOCOL = "stratum-preview";

export const buildPreviewUrl = (token: string) => convertFileSrc(token, PREVIEW_PROTOCOL);
