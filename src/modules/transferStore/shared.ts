// Shared transfer-store helpers.
// These utilities keep the focused transition modules small and predictable.
import type { TransferJobCapabilities } from "@/types";
import { NO_TRANSFER_CONTROLS } from "../transferStore.types";
import type {
  TransferJob,
  TransferStatus,
  TransferStoreState,
  TransferThroughputSample,
} from "../transferStore.types";

export type StartLocalTransferInput = {
  id: string;
  label: string;
  total: number;
  items?: string[];
};

const TRANSFER_THROUGHPUT_WINDOW_MS = 4_000;

export const normalizeItems = (items?: string[]) => {
  return items?.map((value) => value.trim()).filter(Boolean);
};

export const getDefaultJobLabel = (kind: TransferJob["kind"]) => {
  switch (kind) {
    case "copy":
      return "Copy";
    case "delete":
      return "Delete";
    case "move":
      return "Move";
    case "trash":
      return "Trash";
    case "conversion":
      return "Conversion";
    case "transfer":
    default:
      return "Transfer";
  }
};

export const isTerminalStatus = (status: TransferStatus) => {
  return status === "completed" || status === "failed" || status === "cancelled";
};

export const isActiveStatus = (status: TransferStatus) => {
  return status === "queued" || status === "running" || status === "paused";
};

export const buildThroughputSamples = (
  previousSamples: TransferThroughputSample[] | undefined,
  status: TransferStatus,
  processed: number,
  bytesCompleted: number,
  now: number,
) => {
  if (status === "queued") {
    return [] satisfies TransferThroughputSample[];
  }

  const recentSamples = (previousSamples ?? []).filter(
    (sample) => now - sample.recordedAt <= TRANSFER_THROUGHPUT_WINDOW_MS,
  );
  const lastSample = recentSamples[recentSamples.length - 1];
  const shouldAppend =
    !lastSample ||
    lastSample.processed !== processed ||
    lastSample.bytesCompleted !== bytesCompleted;

  if (status === "running" || status === "paused") {
    if (shouldAppend) {
      recentSamples.push({
        recordedAt: now,
        processed,
        bytesCompleted,
      });
    }
    if (recentSamples.length === 0) {
      recentSamples.push({
        recordedAt: now,
        processed,
        bytesCompleted,
      });
    }
  }

  return recentSamples;
};

export const mapJobs = (
  jobs: TransferJob[],
  updateJob: (job: TransferJob) => TransferJob,
) => {
  let changed = false;
  const nextJobs = jobs.map((job) => {
    const nextJob = updateJob(job);
    if (nextJob !== job) {
      changed = true;
    }
    return nextJob;
  });
  return changed ? nextJobs : jobs;
};

export const updateJobInList = (
  jobs: TransferJob[],
  id: string,
  updateJob: (job: TransferJob) => TransferJob,
) => {
  return mapJobs(jobs, (job) => (job.id === id ? updateJob(job) : job));
};

export const updateJobCollections = (
  state: TransferStoreState,
  id: string,
  updateJob: (job: TransferJob) => TransferJob,
) => {
  return {
    backendJobs: updateJobInList(state.backendJobs, id, updateJob),
    localJobs: updateJobInList(state.localJobs, id, updateJob),
  };
};

export const patchJob = (job: TransferJob, patch: Partial<TransferJob>) => {
  return { ...job, ...patch };
};

export const buildTransferJobCapabilities = (
  capabilities?: TransferJobCapabilities,
) => {
  return capabilities ?? NO_TRANSFER_CONTROLS;
};
