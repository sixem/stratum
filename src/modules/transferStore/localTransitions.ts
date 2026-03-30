// Local transfer transitions for optimistic and frontend-managed jobs.
import { NO_TRANSFER_CONTROLS } from "../transferStore.types";
import type { TransferJob, TransferStoreState } from "../transferStore.types";
import { applyProgressUpdateToJob } from "./progress";
import {
  normalizeItems,
  patchJob,
  StartLocalTransferInput,
  updateJobInList,
} from "./shared";

type LocalTransferProgressUpdate = {
  processed: number;
  total?: number;
  currentPath?: string | null;
  currentBytes?: number | null;
  currentTotalBytes?: number | null;
  progressPercent?: number | null;
  statusText?: string | null;
  rateText?: string | null;
};

export const startLocalJobTransition = (
  state: TransferStoreState,
  input: StartLocalTransferInput,
  now: number,
) => {
  const nextJob: TransferJob = {
    id: input.id,
    label: input.label,
    kind: "conversion",
    backendManaged: false,
    capabilities: NO_TRANSFER_CONTROLS,
    status: "running",
    phase: "executing",
    total: Math.max(0, input.total),
    processed: 0,
    startedAt: now,
    activityAt: now,
    items: normalizeItems(input.items),
    throughputSamples: [],
  };

  return {
    job: nextJob,
    state: {
      ...state,
      localJobs: [...state.localJobs, nextJob],
    },
  };
};

export const updateLocalJobProgressTransition = (
  state: TransferStoreState,
  id: string,
  update: LocalTransferProgressUpdate,
  now: number,
): TransferStoreState => {
  const localJobs = updateJobInList(state.localJobs, id, (job) => {
    if (job.status !== "running" && job.status !== "queued") {
      return job;
    }

    const nextTotal = update.total ?? job.total;
    const nextProcessed = Math.min(
      Math.max(update.processed, 0),
      nextTotal || update.processed,
    );

    return applyProgressUpdateToJob(job, update, {
      now,
      nextStatus: "running",
      nextTotal,
      nextProcessed,
      resetByteHintsOnPathChange: true,
      throughputSample: {
        status: "running",
        processed: nextProcessed,
        bytesCompleted: job.bytesCompleted ?? 0,
      },
    });
  });

  return localJobs === state.localJobs ? state : { ...state, localJobs };
};

export const updateLocalJobLabelTransition = (
  state: TransferStoreState,
  id: string,
  label: string,
): TransferStoreState => {
  const localJobs = updateJobInList(state.localJobs, id, (job) => patchJob(job, { label }));
  return localJobs === state.localJobs ? state : { ...state, localJobs };
};

export const completeLocalJobTransition = (
  state: TransferStoreState,
  id: string,
  patch: Partial<TransferJob> | undefined,
  now: number,
): TransferStoreState => {
  const localJobs = updateJobInList(state.localJobs, id, (job) => {
    const lastPath = job.items?.[job.items.length - 1];
    return {
      ...job,
      ...patch,
      status: "completed",
      processed: job.total ? job.total : job.processed,
      currentPath: job.currentPath ?? lastPath,
      activityAt: now,
      finishedAt: now,
    };
  });

  return localJobs === state.localJobs ? state : { ...state, localJobs };
};

export const failLocalJobTransition = (
  state: TransferStoreState,
  id: string,
  patch: Partial<TransferJob> | undefined,
  now: number,
): TransferStoreState => {
  const localJobs = updateJobInList(state.localJobs, id, (job) => ({
    ...job,
    ...patch,
    status: "failed",
    activityAt: now,
    finishedAt: now,
  }));

  return localJobs === state.localJobs ? state : { ...state, localJobs };
};
