// Subscribes to backend transfer progress events and updates the store.
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useTransferStore } from "@/modules";
import type { TransferProgressEvent } from "@/types";

type UseTransferProgressOptions = {
  enabled: boolean;
};

export const useTransferProgress = ({ enabled }: UseTransferProgressOptions) => {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const stop = await listen<TransferProgressEvent>(
        "transfer_progress",
        (event) => {
          if (!active) return;
          const payload = event.payload;
          if (!payload) return;
          useTransferStore.getState().updateProgress(payload.id, {
            processed: payload.processed,
            total: payload.total,
            currentPath: payload.currentPath,
            currentBytes: payload.currentBytes,
            currentTotalBytes: payload.currentTotalBytes,
          });
        },
      );
      if (!active) {
        stop();
        return;
      }
      unlisten = stop;
    };
    void setup();
    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [enabled]);
};
