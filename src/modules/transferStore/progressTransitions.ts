// Backend progress-hint transitions.
// These hints supplement queue snapshots with richer current-file presentation.
import type { TransferProgressEvent } from "@/types";
import type { TransferStoreState, TransferStatus } from "../transferStore.types";
import { applyProgressUpdateToJob } from "./progress";
import { mapJobs } from "./shared";

export const applyProgressHintTransition = (
  state: TransferStoreState,
  event: TransferProgressEvent,
  now: number,
): TransferStoreState => {
  const updateJob = (job: (typeof state.backendJobs)[number]) => {
    if (job.id !== event.id) {
      return job;
    }

    const nextStatus: TransferStatus =
      job.status === "queued" ? "running" : job.status;
    return applyProgressUpdateToJob(job, event, {
      now,
      nextStatus,
      resetByteHintsOnPathChange: false,
    });
  };

  const backendJobs = mapJobs(state.backendJobs, updateJob);
  const localJobs = mapJobs(state.localJobs, updateJob);

  if (backendJobs === state.backendJobs && localJobs === state.localJobs) {
    return state;
  }

  return {
    ...state,
    backendJobs,
    localJobs,
  };
};
