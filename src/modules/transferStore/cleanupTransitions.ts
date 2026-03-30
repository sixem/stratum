// Cleanup transitions for dismissed and finished transfer jobs.
import { selectTransferJobs } from "../transferStore.selectors";
import type { TransferStoreState } from "../transferStore.types";
import { isActiveStatus, isTerminalStatus } from "./shared";

export const clearFinishedJobsTransition = (state: TransferStoreState): TransferStoreState => {
  const dismissedJobIds = { ...state.dismissedJobIds };
  const clearedJobIds = new Set<string>();

  selectTransferJobs(state).forEach((job) => {
    if (!isTerminalStatus(job.status)) {
      return;
    }
    dismissedJobIds[job.id] = true;
    clearedJobIds.add(job.id);
  });

  return {
    ...state,
    dismissedJobIds,
    jobMetadata: Object.fromEntries(
      Object.entries(state.jobMetadata).filter(([jobId]) => !clearedJobIds.has(jobId)),
    ),
    backendJobs: state.backendJobs.filter((job) => isActiveStatus(job.status)),
    localJobs: state.localJobs.filter((job) => isActiveStatus(job.status)),
  };
};
