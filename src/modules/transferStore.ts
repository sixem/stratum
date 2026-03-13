// Transfer UI state backed by backend queue snapshots.
// The backend owns real job lifecycle state; this store adds local labels,
// lightweight timing, and byte-level hints for the current file row.
import { createWithEqualityFn } from "zustand/traditional";
import type {
  TransferJobCapabilities,
  TransferJobKind,
  TransferJobPhase,
  TransferJobSnapshot,
  TransferJobsSnapshotEvent,
  TransferProgressEvent,
  TransferQueueSnapshot,
} from "@/types";

export type TransferStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

type TransferThroughputSample = {
  recordedAt: number;
  processed: number;
  bytesCompleted: number;
};

type LocalTransferJobKind = TransferJobKind | "conversion";

const NO_TRANSFER_CONTROLS: TransferJobCapabilities = {
  canPause: false,
  canCancel: false,
};

export type TransferJob = {
  id: string;
  label: string;
  kind: LocalTransferJobKind;
  backendManaged: boolean;
  capabilities: TransferJobCapabilities;
  status: TransferStatus;
  phase: TransferJobPhase;
  total: number;
  processed: number;
  startedAt: number;
  finishedAt?: number;
  items?: string[];
  currentPath?: string;
  currentBytes?: number;
  currentTotalBytes?: number;
  progressPercent?: number;
  statusText?: string;
  rateText?: string;
  currentStartedAt?: number;
  bytesCompleted?: number;
  bytesTotal?: number;
  throughputSamples?: TransferThroughputSample[];
  copied?: number;
  moved?: number;
  skipped?: number;
  failures?: number;
};

type TransferJobRegistration = {
  id: string;
};

type TransferJobMetadata = {
  label: string;
  items?: string[];
  copied?: number;
  moved?: number;
  skipped?: number;
  failures?: number;
};

type TransferStoreState = {
  jobs: TransferJob[];
  backendJobs: TransferJob[];
  localJobs: TransferJob[];
  jobMetadata: Record<string, TransferJobMetadata>;
  dismissedJobIds: Record<string, true>;
};

type TransferStore = TransferStoreState & {
  startJob: (input: { label: string; total: number; items?: string[] }) => TransferJob;
  updateProgress: (
    id: string,
    update: {
      processed: number;
      total?: number;
      currentPath?: string | null;
      currentBytes?: number | null;
      currentTotalBytes?: number | null;
      progressPercent?: number | null;
      statusText?: string | null;
      rateText?: string | null;
    },
  ) => void;
  updateLabel: (id: string, label: string) => void;
  completeJob: (id: string, patch?: Partial<TransferJob>) => void;
  failJob: (id: string, patch?: Partial<TransferJob>) => void;
  registerJob: (input: { label: string; items?: string[] }) => TransferJobRegistration;
  updateJobLabel: (id: string, label: string) => void;
  recordJobOutcome: (
    id: string,
    patch: Partial<Pick<TransferJobMetadata, "copied" | "moved" | "skipped" | "failures">>,
  ) => void;
  applyQueueSnapshot: (snapshot: TransferQueueSnapshot | TransferJobsSnapshotEvent) => void;
  applyProgressHint: (event: TransferProgressEvent) => void;
  clearFinishedJobs: () => void;
};

const createTransferId = () => {
  return `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const TRANSFER_THROUGHPUT_WINDOW_MS = 4_000;

const orderedSnapshotJobs = (snapshot: TransferQueueSnapshot): TransferJobSnapshot[] => {
  const ordered: TransferJobSnapshot[] = [];
  if (snapshot.activeJob) {
    ordered.push(snapshot.activeJob);
  }
  ordered.push(...snapshot.queuedJobs);
  ordered.push(...snapshot.completedJobs);
  return ordered;
};

const normalizeItems = (items?: string[]) => {
  return items?.map((value) => value.trim()).filter(Boolean);
};

const mergeVisibleJobs = (backendJobs: TransferJob[], localJobs: TransferJob[]) => {
  return [...backendJobs, ...localJobs];
};

const getDefaultJobLabel = (kind: LocalTransferJobKind) => {
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

const isTerminalStatus = (status: TransferStatus) => {
  return status === "completed" || status === "failed" || status === "cancelled";
};

const isActiveStatus = (status: TransferStatus) => {
  return status === "queued" || status === "running" || status === "paused";
};

const resolveSnapshotStatus = (
  snapshotStatus: TransferStatus,
  previousStatus?: TransferStatus,
): TransferStatus => {
  if (!previousStatus) {
    return snapshotStatus;
  }
  if (isTerminalStatus(previousStatus)) {
    return previousStatus;
  }
  if (snapshotStatus === "queued" && previousStatus !== "queued") {
    return previousStatus;
  }
  return snapshotStatus;
};

const TRANSFER_PHASE_ORDER: Record<TransferJobPhase, number> = {
  planning: 0,
  executing: 1,
  finalizing: 2,
};

const resolveSnapshotPhase = (
  snapshotPhase: TransferJobPhase,
  resolvedStatus: TransferStatus,
  previousStatus?: TransferStatus,
  previousPhase?: TransferJobPhase,
): TransferJobPhase => {
  if (isTerminalStatus(resolvedStatus)) {
    return "finalizing";
  }
  if (!previousPhase || !previousStatus) {
    return snapshotPhase;
  }
  if (snapshotPhase === "planning" && previousStatus !== "queued") {
    return previousPhase;
  }
  if (TRANSFER_PHASE_ORDER[snapshotPhase] < TRANSFER_PHASE_ORDER[previousPhase]) {
    return previousPhase;
  }
  return snapshotPhase;
};

const buildThroughputSamples = (
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

const buildTransferJob = (
  snapshotJob: TransferJobSnapshot,
  previousJob: TransferJob | undefined,
  metadata: TransferJobMetadata | undefined,
  now: number,
): TransferJob => {
  const total = snapshotJob.work.filesTotal ?? snapshotJob.work.rootsTotal;
  const processed =
    snapshotJob.work.filesTotal != null
      ? snapshotJob.work.filesCompleted
      : snapshotJob.work.rootsCompleted;
  const bytesCompleted = snapshotJob.work.bytesCompleted ?? 0;
  const currentPathChanged =
    snapshotJob.currentPath !== undefined &&
    snapshotJob.currentPath !== previousJob?.currentPath;
  const nextStatus = resolveSnapshotStatus(snapshotJob.status, previousJob?.status);
  const nextPhase = resolveSnapshotPhase(
    snapshotJob.phase,
    nextStatus,
    previousJob?.status,
    previousJob?.phase,
  );
  const startedNow =
    previousJob == null ||
    (previousJob.status === "queued" && nextStatus !== "queued");
  const startedAt = startedNow
    ? now
    : previousJob?.startedAt ?? now;
  const finishedAt =
    nextStatus === "completed" ||
    nextStatus === "failed" ||
    nextStatus === "cancelled"
      ? previousJob?.finishedAt ?? now
      : undefined;
  const keepByteHints = nextStatus === "running" || nextStatus === "paused";
  const currentBytes = keepByteHints && !currentPathChanged
    ? previousJob?.currentBytes
    : undefined;
  const currentTotalBytes = keepByteHints && !currentPathChanged
    ? previousJob?.currentTotalBytes
    : undefined;
  const currentStartedAt = keepByteHints && !currentPathChanged
    ? previousJob?.currentStartedAt
    : undefined;
  const throughputSamples = buildThroughputSamples(
    previousJob?.throughputSamples,
    nextStatus,
    processed,
    bytesCompleted,
    now,
  );

  return {
    id: snapshotJob.id,
    label:
      metadata?.label ??
      previousJob?.label ??
      getDefaultJobLabel(snapshotJob.kind),
    kind: snapshotJob.kind,
    backendManaged: true,
    capabilities: snapshotJob.capabilities,
    status: nextStatus,
    phase: nextPhase,
    total,
    processed,
    startedAt,
    finishedAt,
    items: metadata?.items ?? previousJob?.items,
    currentPath: snapshotJob.currentPath ?? previousJob?.currentPath,
    currentBytes,
    currentTotalBytes,
    currentStartedAt,
    bytesCompleted,
    bytesTotal: snapshotJob.work.bytesTotal ?? undefined,
    throughputSamples,
    copied: metadata?.copied ?? previousJob?.copied,
    moved: metadata?.moved ?? previousJob?.moved,
    skipped: metadata?.skipped ?? previousJob?.skipped,
    failures: metadata?.failures ?? previousJob?.failures,
  };
};

const applyProgressHintToJob = (job: TransferJob, event: TransferProgressEvent): TransferJob => {
  if (job.id !== event.id) {
    return job;
  }

  const nextCurrentPath =
    event.currentPath === undefined
      ? job.currentPath
      : event.currentPath ?? undefined;
  const nextCurrentBytes =
    event.currentBytes === undefined
      ? job.currentBytes
      : event.currentBytes ?? undefined;
  const nextCurrentTotalBytes =
    event.currentTotalBytes === undefined
      ? job.currentTotalBytes
      : event.currentTotalBytes ?? undefined;
  const nextProgressPercent =
    event.progressPercent === undefined
      ? job.progressPercent
      : event.progressPercent ?? undefined;
  const nextStatusText =
    event.statusText === undefined
      ? job.statusText
      : event.statusText ?? undefined;
  const nextRateText =
    event.rateText === undefined
      ? job.rateText
      : event.rateText ?? undefined;
  const pathChanged = nextCurrentPath != null && nextCurrentPath !== job.currentPath;
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

  const nextStatus: TransferStatus =
    job.status === "queued" ? "running" : job.status;

  return {
    ...job,
    status: nextStatus,
    kind: job.kind,
    backendManaged: job.backendManaged,
    capabilities: job.capabilities,
    startedAt: job.status === "queued" ? Date.now() : job.startedAt,
    currentPath: nextCurrentPath,
    currentBytes: nextCurrentBytes,
    currentTotalBytes: nextCurrentTotalBytes,
    progressPercent:
      pathChanged && event.progressPercent === undefined ? undefined : nextProgressPercent,
    statusText: pathChanged && event.statusText === undefined ? undefined : nextStatusText,
    rateText: pathChanged && event.rateText === undefined ? undefined : nextRateText,
    currentStartedAt,
  };
};

export const useTransferStore = createWithEqualityFn<TransferStore>((set) => ({
  jobs: [],
  backendJobs: [],
  localJobs: [],
  jobMetadata: {},
  dismissedJobIds: {},
  startJob: ({ label, total, items }) => {
    const nextJob: TransferJob = {
      id: createTransferId(),
      label,
      kind: "conversion",
      backendManaged: false,
      capabilities: NO_TRANSFER_CONTROLS,
      status: "running",
      phase: "executing",
      total: Math.max(0, total),
      processed: 0,
      startedAt: Date.now(),
      items: normalizeItems(items),
      throughputSamples: [],
    };
    set((state) => {
      const localJobs = [...state.localJobs, nextJob];
      return {
        localJobs,
        jobs: mergeVisibleJobs(state.backendJobs, localJobs),
      };
    });
    return nextJob;
  },
  updateProgress: (id, update) =>
    set((state) => {
      const localJobs = state.localJobs.map((job) => {
        if (job.id !== id || (job.status !== "running" && job.status !== "queued")) {
          return job;
        }
        const becameRunning = job.status === "queued";
        const startedAt = becameRunning ? Date.now() : job.startedAt;
        const nextTotal = update.total ?? job.total;
        const nextProcessed = Math.min(
          Math.max(update.processed, 0),
          nextTotal || update.processed,
        );
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
        const nextProgressPercent =
          update.progressPercent === undefined
            ? job.progressPercent
            : update.progressPercent ?? undefined;
        const nextStatusText =
          update.statusText === undefined
            ? job.statusText
            : update.statusText ?? undefined;
        const nextRateText =
          update.rateText === undefined
            ? job.rateText
            : update.rateText ?? undefined;
        const pathChanged = nextCurrentPath && nextCurrentPath !== job.currentPath;
        if (pathChanged && update.currentBytes === undefined) {
          nextCurrentBytes = undefined;
          nextCurrentTotalBytes = undefined;
        }
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
        const nextJob: TransferJob = {
          ...job,
          status: "running",
          startedAt,
          total: nextTotal,
          processed: nextProcessed,
          currentPath: nextCurrentPath,
          currentBytes: nextCurrentBytes,
          currentTotalBytes: nextCurrentTotalBytes,
          progressPercent:
            pathChanged && update.progressPercent === undefined ? undefined : nextProgressPercent,
          statusText:
            pathChanged && update.statusText === undefined ? undefined : nextStatusText,
          rateText:
            pathChanged && update.rateText === undefined ? undefined : nextRateText,
          currentStartedAt,
          throughputSamples: buildThroughputSamples(
            job.throughputSamples,
            "running",
            nextProcessed,
            job.bytesCompleted ?? 0,
            Date.now(),
          ),
        };
        return nextJob;
      });
      return {
        localJobs,
        jobs: mergeVisibleJobs(state.backendJobs, localJobs),
      };
    }),
  updateLabel: (id, label) =>
    set((state) => {
      const localJobs = state.localJobs.map((job) =>
        job.id === id ? { ...job, label } : job,
      );
      return {
        localJobs,
        jobs: mergeVisibleJobs(state.backendJobs, localJobs),
      };
    }),
  completeJob: (id, patch) =>
    set((state) => {
      const localJobs = state.localJobs.map((job) => {
        if (job.id !== id) return job;
        const lastPath = job.items?.[job.items.length - 1];
        const nextJob: TransferJob = {
          ...job,
          ...patch,
          status: "completed",
          processed: job.total ? job.total : job.processed,
          currentPath: job.currentPath ?? lastPath,
          finishedAt: Date.now(),
        };
        return nextJob;
      });
      return {
        localJobs,
        jobs: mergeVisibleJobs(state.backendJobs, localJobs),
      };
    }),
  failJob: (id, patch) =>
    set((state) => {
      const localJobs = state.localJobs.map((job) => {
        if (job.id !== id) {
          return job;
        }
        const nextJob: TransferJob = {
          ...job,
          ...patch,
          status: "failed",
          finishedAt: Date.now(),
        };
        return nextJob;
      });
      return {
        localJobs,
        jobs: mergeVisibleJobs(state.backendJobs, localJobs),
      };
    }),
  registerJob: ({ label, items }) => {
    const id = createTransferId();
    set((state) => ({
      jobMetadata: {
        ...state.jobMetadata,
        [id]: {
          ...state.jobMetadata[id],
          label,
          items: normalizeItems(items),
        },
      },
    }));
    return { id };
  },
  updateJobLabel: (id, label) =>
    set((state) => {
      const backendJobs = state.backendJobs.map((job) =>
        job.id === id ? { ...job, label } : job,
      );
      const localJobs = state.localJobs.map((job) =>
        job.id === id ? { ...job, label } : job,
      );
      return {
        jobMetadata: {
          ...state.jobMetadata,
          [id]: {
            ...state.jobMetadata[id],
            label,
          },
        },
        backendJobs,
        localJobs,
        jobs: mergeVisibleJobs(backendJobs, localJobs),
      };
    }),
  recordJobOutcome: (id, patch) =>
    set((state) => {
      const backendJobs = state.backendJobs.map((job) =>
        job.id === id
          ? {
              ...job,
              ...patch,
            }
          : job,
      );
      const localJobs = state.localJobs.map((job) =>
        job.id === id
          ? {
              ...job,
              ...patch,
            }
          : job,
      );
      return {
        jobMetadata: {
          ...state.jobMetadata,
          [id]: {
            ...state.jobMetadata[id],
            ...patch,
          },
        },
        backendJobs,
        localJobs,
        jobs: mergeVisibleJobs(backendJobs, localJobs),
      };
    }),
  applyQueueSnapshot: (snapshot) =>
    set((state) => {
      const previousJobsById = new Map(state.jobs.map((job) => [job.id, job]));
      const now = Date.now();
      const backendJobs = orderedSnapshotJobs(snapshot)
        .filter((job) => {
          const dismissed = state.dismissedJobIds[job.id];
          if (!dismissed) return true;
          return (
            job.status === "queued" ||
            job.status === "running" ||
            job.status === "paused"
          );
        })
        .map((job) =>
          buildTransferJob(
            job,
            previousJobsById.get(job.id),
            state.jobMetadata[job.id],
            now,
          ),
        );

      return {
        backendJobs,
        jobs: mergeVisibleJobs(backendJobs, state.localJobs),
      };
    }),
  applyProgressHint: (event) =>
    set((state) => {
      const backendJobs = state.backendJobs.map((job) =>
        applyProgressHintToJob(job, event),
      );
      const localJobs = state.localJobs.map((job) =>
        applyProgressHintToJob(job, event),
      );
      return {
        backendJobs,
        localJobs,
        jobs: mergeVisibleJobs(backendJobs, localJobs),
      };
    }),
  clearFinishedJobs: () =>
    set((state) => {
      const dismissedJobIds = { ...state.dismissedJobIds };
      const clearedJobIds = new Set<string>();
      state.jobs.forEach((job) => {
        if (!isTerminalStatus(job.status)) {
          return;
        }
        dismissedJobIds[job.id] = true;
        clearedJobIds.add(job.id);
      });
      const backendJobs = state.backendJobs.filter((job) => isActiveStatus(job.status));
      const localJobs = state.localJobs.filter((job) => isActiveStatus(job.status));
      return {
        dismissedJobIds,
        jobMetadata: Object.fromEntries(
          Object.entries(state.jobMetadata).filter(([jobId]) => !clearedJobIds.has(jobId)),
        ),
        backendJobs,
        localJobs,
        jobs: mergeVisibleJobs(backendJobs, localJobs),
      };
    }),
}));
