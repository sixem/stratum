// Tracks active and recent file transfers for lightweight status UI.
import { createWithEqualityFn } from "zustand/traditional";

export type TransferStatus = "running" | "completed" | "failed";

export type TransferJob = {
  id: string;
  label: string;
  total: number;
  processed: number;
  status: TransferStatus;
  startedAt: number;
  finishedAt?: number;
  items?: string[];
  currentPath?: string;
  currentBytes?: number;
  currentTotalBytes?: number;
  currentStartedAt?: number;
  copied?: number;
  moved?: number;
  skipped?: number;
  failures?: number;
};

// Transfer jobs flow start -> updateProgress (0..n) -> complete/fail.
// `currentPath` and byte fields are optional hints for the UI, not a strict audit log.
type TransferProgressUpdate = {
  processed: number;
  total?: number;
  currentPath?: string | null;
  currentBytes?: number | null;
  currentTotalBytes?: number | null;
};

type TransferStore = {
  jobs: TransferJob[];
  startJob: (input: { label: string; total: number; items?: string[] }) => TransferJob;
  updateProgress: (id: string, update: TransferProgressUpdate) => void;
  updateLabel: (id: string, label: string) => void;
  completeJob: (id: string, patch?: Partial<TransferJob>) => void;
  failJob: (id: string, patch?: Partial<TransferJob>) => void;
  clearAll: () => void;
};

const createTransferId = () => {
  return `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const useTransferStore = createWithEqualityFn<TransferStore>((set) => ({
  jobs: [],
  startJob: ({ label, total, items }) => {
    const nextJob: TransferJob = {
      id: createTransferId(),
      label,
      total: Math.max(0, total),
      processed: 0,
      status: "running",
      startedAt: Date.now(),
      items: items?.map((value) => value.trim()).filter(Boolean),
    };
    set((state) => {
      const hasActive = state.jobs.some((job) => job.status === "running");
      const jobs = hasActive ? state.jobs : [];
      return { jobs: [...jobs, nextJob] };
    });
    return nextJob;
  },
  updateProgress: (id, update) =>
    set((state) => ({
      jobs: state.jobs.map((job) => {
        if (job.id !== id || job.status !== "running") return job;
        // Clamp processed counts so totals never go backwards or overshoot.
        const nextTotal = update.total ?? job.total;
        const nextProcessed = Math.min(
          Math.max(update.processed, 0),
          nextTotal || update.processed,
        );
        // Preserve the current path unless an explicit update arrives.
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
        // If we weren't given a path, fall back to the source item list.
        const items = job.items;
        let currentPath = nextCurrentPath ?? job.currentPath;
        if (!nextCurrentPath && items && items.length > 0) {
          const index = Math.min(Math.max(nextProcessed - 1, 0), items.length - 1);
          currentPath = items[index] ?? currentPath;
        }
        const pathChanged = nextCurrentPath && nextCurrentPath !== job.currentPath;
        // Reset byte counters when the file changes unless the backend sent bytes.
        if (pathChanged && update.currentBytes === undefined) {
          nextCurrentBytes = undefined;
          nextCurrentTotalBytes = undefined;
        }
        // Restart the per-file timer when byte progress jumps or total changes.
        const bytesReset =
          nextCurrentBytes != null &&
          (job.currentBytes == null || nextCurrentBytes < job.currentBytes);
        const totalBytesChanged =
          nextCurrentTotalBytes != null &&
          nextCurrentTotalBytes !== job.currentTotalBytes;
        let currentStartedAt = job.currentStartedAt;
        if (pathChanged || bytesReset || totalBytesChanged) {
          currentStartedAt = Date.now();
        }
        if (!currentStartedAt && nextCurrentBytes != null) {
          currentStartedAt = Date.now();
        }
        return {
          ...job,
          total: nextTotal,
          processed: nextProcessed,
          currentPath,
          currentBytes: nextCurrentBytes,
          currentTotalBytes: nextCurrentTotalBytes,
          currentStartedAt,
        };
      }),
    })),
  updateLabel: (id, label) =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === id ? { ...job, label } : job)),
    })),
  completeJob: (id, patch) =>
    set((state) => ({
      jobs: state.jobs.map((job) => {
        if (job.id !== id) return job;
        const lastPath = job.items?.[job.items.length - 1];
        return {
          ...job,
          ...patch,
          status: "completed",
          processed: job.total ? job.total : job.processed,
          currentPath: job.currentPath ?? lastPath,
          finishedAt: Date.now(),
        };
      }),
    })),
  failJob: (id, patch) =>
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id
          ? { ...job, ...patch, status: "failed", finishedAt: Date.now() }
          : job,
      ),
    })),
  clearAll: () => set({ jobs: [] }),
}));
