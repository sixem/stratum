// Progress-field reconciliation shared by local updates and backend hints.
// Keeping this in one place prevents subtle UI drift between progress paths.
import type { TransferProgressEvent } from "@/types";
import type { TransferJob, TransferStatus } from "../transferStore.types";
import { buildThroughputSamples } from "./shared";

export type TransferProgressPresentationUpdate = Pick<
  TransferProgressEvent,
  | "currentPath"
  | "currentBytes"
  | "currentTotalBytes"
  | "progressPercent"
  | "statusText"
  | "rateText"
>;

type ApplyProgressPresentationOptions = {
  now: number;
  resetByteHintsOnPathChange: boolean;
};

type ThroughputSampleOptions = {
  status: TransferStatus;
  processed: number;
  bytesCompleted: number;
};

type ApplyProgressUpdateToJobOptions = ApplyProgressPresentationOptions & {
  nextStatus?: TransferStatus;
  nextTotal?: number;
  nextProcessed?: number;
  throughputSample?: ThroughputSampleOptions;
};

export const applyProgressPresentation = (
  job: TransferJob,
  update: TransferProgressPresentationUpdate,
  { now, resetByteHintsOnPathChange }: ApplyProgressPresentationOptions,
) => {
  const nextCurrentPath =
    update.currentPath === undefined
      ? job.currentPath
      : update.currentPath ?? undefined;
  let nextCurrentBytes =
    update.currentBytes === undefined
      ? job.currentBytes
      : update.currentBytes ?? undefined;
  let nextCurrentTotalBytes =
    update.currentTotalBytes === undefined
      ? job.currentTotalBytes
      : update.currentTotalBytes ?? undefined;
  let nextProgressPercent =
    update.progressPercent === undefined
      ? job.progressPercent
      : update.progressPercent ?? undefined;
  let nextStatusText =
    update.statusText === undefined
      ? job.statusText
      : update.statusText ?? undefined;
  let nextRateText =
    update.rateText === undefined
      ? job.rateText
      : update.rateText ?? undefined;
  const pathChanged = nextCurrentPath != null && nextCurrentPath !== job.currentPath;

  if (resetByteHintsOnPathChange && pathChanged && update.currentBytes === undefined) {
    nextCurrentBytes = undefined;
    nextCurrentTotalBytes = undefined;
  }

  if (pathChanged) {
    if (update.progressPercent === undefined) {
      nextProgressPercent = undefined;
    }
    if (update.statusText === undefined) {
      nextStatusText = undefined;
    }
    if (update.rateText === undefined) {
      nextRateText = undefined;
    }
  }

  const bytesReset =
    nextCurrentBytes != null &&
    (job.currentBytes == null || nextCurrentBytes < job.currentBytes);
  const totalBytesChanged =
    nextCurrentTotalBytes != null &&
    nextCurrentTotalBytes !== job.currentTotalBytes;
  let currentStartedAt = job.currentStartedAt;
  if (pathChanged || bytesReset || totalBytesChanged) {
    currentStartedAt = now;
  }
  if (!currentStartedAt && nextCurrentBytes != null) {
    currentStartedAt = now;
  }

  return {
    currentPath: nextCurrentPath,
    currentBytes: nextCurrentBytes,
    currentTotalBytes: nextCurrentTotalBytes,
    progressPercent: nextProgressPercent,
    statusText: nextStatusText,
    rateText: nextRateText,
    currentStartedAt,
  };
};

export const applyProgressUpdateToJob = (
  job: TransferJob,
  update: TransferProgressPresentationUpdate,
  options: ApplyProgressUpdateToJobOptions,
): TransferJob => {
  const nextStatus = options.nextStatus ?? job.status;
  const nextTotal = options.nextTotal ?? job.total;
  const nextProcessed = options.nextProcessed ?? job.processed;
  const progressPresentation = applyProgressPresentation(job, update, options);

  return {
    ...job,
    status: nextStatus,
    startedAt:
      job.status === "queued" && nextStatus !== "queued" ? options.now : job.startedAt,
    activityAt: options.now,
    total: nextTotal,
    processed: nextProcessed,
    ...progressPresentation,
    throughputSamples: options.throughputSample
      ? buildThroughputSamples(
          job.throughputSamples,
          options.throughputSample.status,
          options.throughputSample.processed,
          options.throughputSample.bytesCompleted,
          options.now,
        )
      : job.throughputSamples,
  };
};
