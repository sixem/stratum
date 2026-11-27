// Follow one job through execution, the completion hold, and the fade.
import type { TransferJob } from "@/modules/transferStore.types";

const COMPLETION_HOLD_MS = 700;
export const WORK_PILL_FADE_MS = 450;

export type WorkPillProgress = {
  jobId: string;
  fraction: number;
  transition: { phase: "hold" | "fade"; until: number } | null;
};

const getJobFraction = (job: TransferJob): number | null => {
  if (job.phase === "planning") return null;
  const percent = job.progressPercent;
  if (percent !== undefined && Number.isFinite(percent) && percent >= 0) {
    return Math.min(percent / 100, 1);
  }
  // Delete and trash jobs have byte estimates, but report progress in items.
  const bytesTotal = job.bytesTotal ?? 0;
  const useBytes = job.kind !== "delete" && job.kind !== "trash" && bytesTotal > 0;
  // Remote single-item transfers may know the current file size without a
  // whole-job estimate. Show that progress instead of a motionless 0/1.
  if (!useBytes && job.kind !== "delete" && job.kind !== "trash" && job.total === 1 &&
      job.currentTotalBytes != null && job.currentTotalBytes > 0 && job.currentBytes != null) {
    return Math.min(Math.max(job.currentBytes / job.currentTotalBytes, 0), 1);
  }
  if (!useBytes && job.total === 1 && job.processed === 0 && job.statusText &&
      (job.currentTotalBytes == null || job.currentTotalBytes <= 0)) return null;
  const total = useBytes ? bytesTotal : job.total;
  const completed = useBytes ? job.bytesCompleted ?? 0 : job.processed;
  return Number.isFinite(total) && total > 0 && Number.isFinite(completed)
    ? Math.min(Math.max(completed / total, 0), 1)
    : null;
};

const selectJob = (jobs: readonly TransferJob[], status: "running" | "paused"): WorkPillProgress | null => {
  let selected: WorkPillProgress | null = null;
  let oldestStart = Infinity;
  for (const job of jobs) {
    if (job.status !== status || job.startedAt >= oldestStart) continue;
    const fraction = getJobFraction(job);
    if (fraction === null) continue;
    selected = { jobId: job.id, fraction, transition: null };
    oldestStart = job.startedAt;
  }
  return selected;
};

const fade = (current: WorkPillProgress, now: number): WorkPillProgress => ({
  ...current,
  transition: { phase: "fade", until: now + WORK_PILL_FADE_MS },
});

export const advanceWorkPillProgress = (
  current: WorkPillProgress | null,
  jobs: readonly TransferJob[],
  now: number,
): WorkPillProgress | null => {
  if (current?.transition) {
    if (now < current.transition.until) return current;
    if (current.transition.phase === "hold" && now < current.transition.until + WORK_PILL_FADE_MS) {
      return fade(current, now);
    }
  } else if (current) {
    const job = jobs.find(({ id }) => id === current.jobId);
    if (job?.status === "completed") {
      return { ...current, fraction: 1, transition: { phase: "hold", until: now + COMPLETION_HOLD_MS } };
    }
    if (job?.status === "running" || (job?.status === "paused" && !selectJob(jobs, "running"))) {
      // File estimates can grow and intermediate updates can lose their byte
      // hints. Keep the displayed fraction steady until this job moves forward.
      const fraction = getJobFraction(job);
      return fraction !== null && fraction > current.fraction ? { ...current, fraction } : current;
    }
    return fade(current, now);
  }

  // Older running work keeps the pill even when a later job reports more often.
  return selectJob(jobs, "running") ?? selectJob(jobs, "paused");
};
