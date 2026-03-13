// Backend-managed conversion queue API.
import { invoke } from "@tauri-apps/api/core";
import type { ConversionJobItem, ConversionReport } from "@/types";

export const convertMediaEntries = (
  items: ConversionJobItem[],
  transferId?: string,
) =>
  invoke<ConversionReport>("convert_media_entries", {
    items,
    transferId,
  });
