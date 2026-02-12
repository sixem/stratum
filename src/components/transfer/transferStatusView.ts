// View-model helpers for the transfer status popover.
// Keeps formatting and per-job calculations in one place for readability.
import { formatBytes, getPathName } from "@/lib";
import type { TransferJob, TransferStatus } from "@/modules/transferStore";

export type TransferSummary = {
  activeCount: number;
  hasActive: boolean;
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

export const buildTransferSummary = (jobs: TransferJob[]): TransferSummary => {
  const active = jobs.filter((job) => job.status === "running");
  const activeCount = active.length;
  const hasActive = activeCount > 0;
  const latestJob = jobs.length > 0 ? jobs[jobs.length - 1] ?? null : null;
  const countLabel = hasActive
    ? `${activeCount} active`
    : latestJob?.status === "failed"
      ? "Failed"
      : "Complete";
  const title = hasActive ? "Transfers in progress" : "Last transfer";

  return {
    activeCount,
    hasActive,
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
  const hasByteProgress =
    job.currentBytes != null &&
    job.currentTotalBytes != null &&
    job.currentTotalBytes > 0;
  const progress = hasByteProgress
    ? Math.min((job.currentBytes ?? 0) / (job.currentTotalBytes ?? 1), 1)
    : total > 0
      ? Math.min(processed / total, 1)
      : 0;
  const progressDecimals = hasByteProgress ? 1 : 0;
  const progressPercentValue =
    hasByteProgress || total > 0
      ? Number((progress * 100).toFixed(progressDecimals))
      : null;
  const progressPercentText =
    progressPercentValue != null
      ? `${progressPercentValue.toFixed(progressDecimals)}%`
      : null;
  // Nudge the count while running so the UI feels responsive to the first tick.
  const displayProcessed =
    job.status === "running" && total > 0 && processed < total
      ? Math.min(processed + 1, total)
      : processed;
  const finishedAt = job.finishedAt ?? now;
  const elapsedMs = finishedAt - job.startedAt;
  const byteElapsedMs =
    job.currentStartedAt != null ? finishedAt - job.currentStartedAt : elapsedMs;
  const byteRate =
    hasByteProgress && job.currentBytes != null
      ? formatByteRate(job.currentBytes, byteElapsedMs)
      : null;
  const rate = formatRate(processed, elapsedMs);
  const statusLabel =
    job.status === "completed"
      ? `Completed in ${formatDuration(elapsedMs)}`
      : job.status === "failed"
        ? "Failed"
        : hasByteProgress
          ? `${formatBytes(job.currentBytes ?? 0)} / ${formatBytes(
              job.currentTotalBytes ?? null,
            )}`
          : total > 0
            ? `${processed}/${total} items`
            : "Working...";
  const currentName = job.currentPath ? getPathName(job.currentPath) : "";
  const fileLabel = currentName
    ? job.status === "completed"
      ? "Last file"
      : "File"
    : null;
  const countLabelBase = total > 0 ? `${displayProcessed}/${total}` : `${processed}`;
  const countLabel = progressPercentText
    ? `${countLabelBase} (${progressPercentText})`
    : countLabelBase;
  const indeterminate =
    job.status === "running" && !hasByteProgress && processed === 0;

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
    rateLabel: byteRate ?? rate,
  };
};
