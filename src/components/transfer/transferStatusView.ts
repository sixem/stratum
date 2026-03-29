// View-model helpers for the work-log popover.
// Keeps formatting and per-job calculations in one place for readability.
import { formatBytes, getPathName } from "@/lib";
import type { TransferJob, TransferStatus } from "@/modules/transferStore";

export type TransferSummary = {
  activeCount: number;
  queuedCount: number;
  finishedCount: number;
  hasActive: boolean;
  hasFinished: boolean;
  latestJob: TransferJob | null;
  countLabel: string;
  title: string;
};

export type TransferItemView = {
  id: string;
  status: TransferStatus;
  label: string;
  countLabel: string;
  fileLabel: string | null;
  fileName: string | null;
  progress: number;
  progressPercentText: string | null;
  progressPercentValue: number | null;
  indeterminate: boolean;
  statusLabel: string;
  rateLabel: string | null;
};

const TRANSFER_RECENT_RATE_WINDOW_MS = 4_000;

const getTransferJobRecentAt = (job: TransferJob) => {
  return job.activityAt ?? job.finishedAt ?? job.startedAt;
};

export const sortTransferJobsByRecent = (jobs: TransferJob[]) => {
  return [...jobs].sort((left, right) => {
    const recentDelta = getTransferJobRecentAt(right) - getTransferJobRecentAt(left);
    if (recentDelta !== 0) return recentDelta;
    return right.startedAt - left.startedAt;
  });
};

const formatDuration = (elapsedMs: number) => {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return "0s";
  const totalSeconds = Math.round(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
};

const formatRate = (count: number, elapsedMs: number) => {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || count <= 0) return null;
  const perSecond = count / (elapsedMs / 1000);
  if (!Number.isFinite(perSecond) || perSecond <= 0) return null;
  return `${perSecond.toFixed(1)} items/s`;
};

const formatByteRate = (bytes: number, elapsedMs: number) => {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || bytes <= 0) return null;
  const perSecond = bytes / (elapsedMs / 1000);
  if (!Number.isFinite(perSecond) || perSecond <= 0) return null;
  return `${formatBytes(perSecond)}/s`;
};

const buildRecentThroughputLabel = (job: TransferJob, now: number) => {
  if (job.status !== "running") {
    return null;
  }

  const recentSamples = (job.throughputSamples ?? []).filter(
    (sample) => now - sample.recordedAt <= TRANSFER_RECENT_RATE_WINDOW_MS,
  );
  if (recentSamples.length < 2) {
    return null;
  }

  const firstSample = recentSamples[0];
  const lastSample = recentSamples[recentSamples.length - 1];
  if (!firstSample || !lastSample) {
    return null;
  }

  const elapsedMs = lastSample.recordedAt - firstSample.recordedAt;
  if (elapsedMs <= 0) {
    return null;
  }

  const bytesDelta = lastSample.bytesCompleted - firstSample.bytesCompleted;
  if (bytesDelta > 0) {
    return formatByteRate(bytesDelta, elapsedMs);
  }

  const itemsDelta = lastSample.processed - firstSample.processed;
  if (itemsDelta > 0) {
    return formatRate(itemsDelta, elapsedMs);
  }

  return null;
};

export const buildTransferSummary = (jobs: TransferJob[]): TransferSummary => {
  const recentJobs = sortTransferJobsByRecent(jobs);
  const active = jobs.filter(
    (job) => job.status === "running" || job.status === "paused",
  );
  const queued = jobs.filter((job) => job.status === "queued");
  const finished = jobs.filter(
    (job) =>
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled",
  );
  const activeCount = active.length;
  const queuedCount = queued.length;
  const finishedCount = finished.length;
  const hasActive = activeCount > 0 || queuedCount > 0;
  const hasFinished = finishedCount > 0;
  const latestJob = recentJobs[0] ?? null;
  const countLabel = hasActive
    ? activeCount > 0 && queuedCount > 0
      ? `${activeCount} active, ${queuedCount} queued`
      : activeCount > 0
        ? `${activeCount} active`
        : `${queuedCount} queued`
    : latestJob?.status === "failed"
      ? "Failed"
      : latestJob?.status === "cancelled"
        ? "Cancelled"
      : "Complete";
  const title = hasActive
    ? queuedCount > 0
      ? "Work queue"
      : "Work in progress"
    : "Recent jobs";

  return {
    activeCount,
    queuedCount,
    finishedCount,
    hasActive,
    hasFinished,
    latestJob,
    countLabel,
    title,
  };
};

export const buildTransferItemView = (
  job: TransferJob,
  now: number,
): TransferItemView => {
  const total = job.total || 0;
  const processed = job.processed || 0;
  const isQueued = job.status === "queued";
  const isPlanning =
    (job.status === "running" || job.status === "paused") &&
    job.phase === "planning";
  const hasByteProgress =
    !isQueued &&
    !isPlanning &&
    job.currentBytes != null &&
    job.currentTotalBytes != null &&
    job.currentTotalBytes > 0;
  const hasGenericProgress =
    !isQueued &&
    Number.isFinite(job.progressPercent) &&
    (job.progressPercent ?? 0) >= 0;
  const isExecutionWarmup =
    job.status === "running" &&
    !isPlanning &&
    !hasGenericProgress &&
    !hasByteProgress &&
    processed === 0 &&
    !!job.statusText;
  const progress = isQueued
    ? 0
    : hasGenericProgress
    ? Math.min(Math.max((job.progressPercent ?? 0) / 100, 0), 1)
    : hasByteProgress
    ? Math.min((job.currentBytes ?? 0) / (job.currentTotalBytes ?? 1), 1)
    : total > 0
      ? Math.min(processed / total, 1)
      : 0;
  const progressDecimals = hasByteProgress || hasGenericProgress ? 1 : 0;
  const progressPercentValue =
    !isQueued && !isPlanning && (hasGenericProgress || hasByteProgress || total > 0)
      ? Number((progress * 100).toFixed(progressDecimals))
      : null;
  const progressPercentText =
    progressPercentValue != null
      ? `${progressPercentValue.toFixed(progressDecimals)}%`
      : null;
  const finishedAt = job.finishedAt ?? now;
  const elapsedMs = finishedAt - job.startedAt;
  const recentRate = buildRecentThroughputLabel(job, now);
  const statusLabel =
    job.status === "queued"
      ? "Queued"
      : job.status === "paused"
        ? "Paused"
      : job.status === "completed"
        ? `Completed in ${formatDuration(elapsedMs)}`
        : job.status === "cancelled"
          ? "Cancelled"
      : job.status === "failed"
        ? "Failed"
        : isPlanning
          ? job.statusText ?? "Planning..."
        : job.statusText
          ? job.statusText
        : hasByteProgress
          ? `${formatBytes(job.currentBytes ?? 0)} / ${formatBytes(
              job.currentTotalBytes ?? null,
            )}`
          : total > 0
            ? `${processed}/${total} items`
            : "Working...";
  const currentName = job.currentPath ? getPathName(job.currentPath) : "";
  const fileLabel = currentName
    ? isPlanning
      ? "Scanning"
      : job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled"
      ? "Last item"
      : "Item"
    : null;
  const countLabel = isPlanning || isExecutionWarmup
    ? total > 0
      ? `${total.toLocaleString()} items`
      : "Preparing..."
    : total > 0
      ? `${processed}/${total} items`
      : `${processed} items`;
  const indeterminate =
    isPlanning ||
    (job.status === "running" && !hasGenericProgress && !hasByteProgress && processed === 0);

  return {
    id: job.id,
    status: job.status,
    label: job.label,
    countLabel,
    fileLabel,
    fileName: currentName || null,
    progress,
    progressPercentText,
    progressPercentValue,
    indeterminate,
    statusLabel,
    rateLabel: job.rateText ?? recentRate,
  };
};
