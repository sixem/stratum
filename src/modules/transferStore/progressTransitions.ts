// Backend progress-hint transitions.
// These hints supplement queue snapshots with richer current-file presentation.
import type { TransferProgressEvent } from "@/types";
import type { TransferStoreState } from "../transferStore.types";
import { applyProgressUpdateToJob } from "./progress";
import { isTerminalStatus, mapJobs } from "./shared";

export const applyProgressHintTransition = (
  state: TransferStoreState,
  event: TransferProgressEvent,
  now: number,
): TransferStoreState => {
  const updateJob = (job: (typeof state.backendJobs)[number]) => {
    if (job.id !== event.id || isTerminalStatus(job.status)) {
      return job;
    }

    // The queue snapshot owns status so late hints cannot turn waiting work active.
    return applyProgressUpdateToJob(job, event, {
      now,
      resetByteHintsOnPathChange: true,
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
