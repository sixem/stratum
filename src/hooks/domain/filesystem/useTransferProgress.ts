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
    const unlisten: Array<() => void> = [];
    const settledPaths = new Map<string, Set<string>>();
    let settledPathsFrame: number | null = null;
    const queueSettledPaths = (id: string, items: NonNullable<TransferProgressEvent["completedItems"]>) => {
      let paths = settledPaths.get(id);
      if (!paths) {
        paths = new Set();
        settledPaths.set(id, paths);
      }
      for (const { path } of items) paths.add(path);
      if (settledPathsFrame != null) return;

      // Batch fast same-drive moves into one explorer update per frame.
      settledPathsFrame = window.requestAnimationFrame(() => {
        settledPathsFrame = null;
        useTransferStore.getState().settleFilePaths(settledPaths);
        settledPaths.clear();
      });
    };
    const setup = async () => {
      const stopSnapshots = await listen<TransferJobsSnapshotEvent>(
        "transfer_jobs_snapshot",
        (event) => {
          if (!active) return;
          const payload = event.payload;
          if (!payload) return;
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
          if (payload.completedItems?.length) {
            queueSettledPaths(payload.id, payload.completedItems);
          }
          useTransferStore.getState().applyProgressHint(payload);
        },
      );
      if (!active) {
        stopProgress();
        return;
      }
      unlisten.push(stopProgress);

      const snapshot = await listTransferJobs().catch(() => null);
      if (!active || !snapshot) {
        return;
      }
      useTransferStore.getState().applyQueueSnapshot(snapshot);
    };
    void setup();
    return () => {
      active = false;
      if (settledPathsFrame != null) window.cancelAnimationFrame(settledPathsFrame);
      unlisten.forEach((stop) => stop());
    };
  }, [enabled]);
};
