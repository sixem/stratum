// Subscribes to backend transfer job snapshots and current-file progress hints.
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { listTransferJobs } from "@/api";
import { useTransferStore } from "@/modules";
import type { TransferJobsSnapshotEvent, TransferProgressEvent } from "@/types";

type UseTransferProgressOptions = {
  enabled: boolean;
};

export const useTransferProgress = ({ enabled }: UseTransferProgressOptions) => {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let receivedLiveSnapshot = false;
    const unlisten: Array<() => void> = [];
    const setup = async () => {
      const stopSnapshots = await listen<TransferJobsSnapshotEvent>(
        "transfer_jobs_snapshot",
        (event) => {
          if (!active) return;
          const payload = event.payload;
          if (!payload) return;
          receivedLiveSnapshot = true;
          useTransferStore.getState().applyQueueSnapshot(payload);
        },
      );
      if (!active) {
        stopSnapshots();
        return;
      }
      unlisten.push(stopSnapshots);

      const stopProgress = await listen<TransferProgressEvent>(
        "transfer_progress",
        (event) => {
          if (!active) return;
          const payload = event.payload;
          if (!payload) return;
          useTransferStore.getState().applyProgressHint(payload);
        },
      );
      if (!active) {
        stopProgress();
        return;
      }
      unlisten.push(stopProgress);

      const snapshot = await listTransferJobs().catch(() => null);
      if (!active || receivedLiveSnapshot || !snapshot) {
        return;
      }
      useTransferStore.getState().applyQueueSnapshot(snapshot);
    };
    void setup();
    return () => {
      active = false;
      unlisten.forEach((stop) => stop());
    };
  }, [enabled]);
};
