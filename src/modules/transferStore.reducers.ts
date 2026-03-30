// Pure transfer store transitions.
// These helpers keep the Zustand store focused on wiring while the state rules live here.
import type {
  TransferJobCapabilities,
  TransferJobPhase,
  TransferJobSnapshot,
  TransferJobsSnapshotEvent,
  TransferProgressEvent,
  TransferQueueSnapshot,
} from "@/types";
import { NO_TRANSFER_CONTROLS } from "./transferStore.types";
import type {
  TransferJob,
  TransferJobMetadata,
  TransferStatus,
  TransferStoreState,
  TransferThroughputSample,
} from "./transferStore.types";
import { selectTransferJobs } from "./transferStore.selectors";

type TransferProgressPresentationUpdate = Pick<
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

type StartLocalTransferInput = {
  id: string;
  label: string;
  total: number;
  items?: string[];
};

const TRANSFER_THROUGHPUT_WINDOW_MS = 4_000;

const TRANSFER_PHASE_ORDER: Record<TransferJobPhase, number> = {
  planning: 0,
  executing: 1,
  finalizing: 2,
};

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

const getDefaultJobLabel = (kind: TransferJob["kind"]) => {
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

const mapJobs = (
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

const updateJobInList = (
  jobs: TransferJob[],
  id: string,
  updateJob: (job: TransferJob) => TransferJob,
) => {
  return mapJobs(jobs, (job) => (job.id === id ? updateJob(job) : job));
};

const updateJobCollections = (
  state: TransferStoreState,
  id: string,
  updateJob: (job: TransferJob) => TransferJob,
) => {
  return {
    backendJobs: updateJobInList(state.backendJobs, id, updateJob),
    localJobs: updateJobInList(state.localJobs, id, updateJob),
  };
};

const buildProgressPresentation = (
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
  const pathChanged = nextCurrentPath != null && nextCurrentPath !== job.currentPath;

  if (resetByteHintsOnPathChange && pathChanged && update.currentBytes === undefined) {
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
    currentStartedAt = now;
  }
  if (!currentStartedAt && nextCurrentBytes != null) {
    currentStartedAt = now;
  }

  return {
    nextCurrentPath,
    nextCurrentBytes,
    nextCurrentTotalBytes,
    nextProgressPercent,
    nextStatusText,
    nextRateText,
    currentStartedAt,
    pathChanged,
  };
};

const buildTransferJobFromSnapshot = (
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
  const startedAt = startedNow ? now : previousJob?.startedAt ?? now;
  const activityAt = isTerminalStatus(nextStatus)
    ? isTerminalStatus(previousJob?.status ?? "queued")
      ? previousJob?.activityAt ?? now
      : now
    : now;
  const finishedAt = isTerminalStatus(nextStatus)
    ? previousJob?.finishedAt ?? now
    : undefined;
  const keepByteHints = nextStatus === "running" || nextStatus === "paused";
  const keepTransientHints = keepByteHints && nextPhase === previousJob?.phase;
  const bridgePlanningStatusHint =
    keepByteHints &&
    previousJob?.phase === "planning" &&
    nextPhase === "executing";
  const currentBytes =
    keepByteHints && !currentPathChanged ? previousJob?.currentBytes : undefined;
  const currentTotalBytes =
    keepByteHints && !currentPathChanged
      ? previousJob?.currentTotalBytes
      : undefined;
  const currentStartedAt =
    keepByteHints && !currentPathChanged
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
    activityAt,
    finishedAt,
    items: metadata?.items ?? previousJob?.items,
    currentPath:
      snapshotJob.currentPath !== undefined
        ? snapshotJob.currentPath ?? undefined
        : previousJob?.currentPath,
    currentBytes,
    currentTotalBytes,
    progressPercent: keepTransientHints ? previousJob?.progressPercent : undefined,
    statusText:
      keepTransientHints || bridgePlanningStatusHint
        ? previousJob?.statusText
        : undefined,
    rateText: keepTransientHints ? previousJob?.rateText : undefined,
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

const patchJob = (job: TransferJob, patch: Partial<TransferJob>) => {
  return { ...job, ...patch };
};

export const buildTransferJobCapabilities = (
  capabilities?: TransferJobCapabilities,
) => {
  return capabilities ?? NO_TRANSFER_CONTROLS;
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
    const presentation = buildProgressPresentation(job, update, {
      now,
      resetByteHintsOnPathChange: true,
    });

    return {
      ...job,
      status: "running",
      startedAt: job.status === "queued" ? now : job.startedAt,
      activityAt: now,
      total: nextTotal,
      processed: nextProcessed,
      currentPath: presentation.nextCurrentPath,
      currentBytes: presentation.nextCurrentBytes,
      currentTotalBytes: presentation.nextCurrentTotalBytes,
      progressPercent:
        presentation.pathChanged && update.progressPercent === undefined
          ? undefined
          : presentation.nextProgressPercent,
      statusText:
        presentation.pathChanged && update.statusText === undefined
          ? undefined
          : presentation.nextStatusText,
      rateText:
        presentation.pathChanged && update.rateText === undefined
          ? undefined
          : presentation.nextRateText,
      currentStartedAt: presentation.currentStartedAt,
      throughputSamples: buildThroughputSamples(
        job.throughputSamples,
        "running",
        nextProcessed,
        job.bytesCompleted ?? 0,
        now,
      ),
    };
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

export const registerJobMetadataTransition = (
  state: TransferStoreState,
  id: string,
  input: { label: string; items?: string[] },
): TransferStoreState => {
  return {
    ...state,
    jobMetadata: {
      ...state.jobMetadata,
      [id]: {
        ...state.jobMetadata[id],
        label: input.label,
        items: normalizeItems(input.items),
      },
    },
  };
};

export const updateJobLabelTransition = (
  state: TransferStoreState,
  id: string,
  label: string,
): TransferStoreState => {
  const nextCollections = updateJobCollections(state, id, (job) => patchJob(job, { label }));
  return {
    ...state,
    jobMetadata: {
      ...state.jobMetadata,
      [id]: {
        ...state.jobMetadata[id],
        label,
      },
    },
    ...nextCollections,
  };
};

export const recordJobOutcomeTransition = (
  state: TransferStoreState,
  id: string,
  patch: Partial<Pick<TransferJobMetadata, "copied" | "moved" | "skipped" | "failures">>,
): TransferStoreState => {
  const nextCollections = updateJobCollections(state, id, (job) => patchJob(job, patch));
  return {
    ...state,
    jobMetadata: {
      ...state.jobMetadata,
      [id]: {
        ...state.jobMetadata[id],
        ...patch,
      },
    },
    ...nextCollections,
  };
};

export const applyQueueSnapshotTransition = (
  state: TransferStoreState,
  snapshot: TransferQueueSnapshot | TransferJobsSnapshotEvent,
  now: number,
): TransferStoreState => {
  const previousJobsById = new Map(
    selectTransferJobs(state).map((job) => [job.id, job]),
  );
  const backendJobs = orderedSnapshotJobs(snapshot)
    .filter((job) => {
      const dismissed = state.dismissedJobIds[job.id];
      if (!dismissed) {
        return true;
      }
      return isActiveStatus(job.status);
    })
    .map((job) =>
      buildTransferJobFromSnapshot(
        job,
        previousJobsById.get(job.id),
        state.jobMetadata[job.id],
        now,
      ),
    );

  return {
    ...state,
    backendJobs,
  };
};

export const applyProgressHintTransition = (
  state: TransferStoreState,
  event: TransferProgressEvent,
  now: number,
): TransferStoreState => {
  const updateJob = (job: TransferJob) => {
    if (job.id !== event.id) {
      return job;
    }

    const presentation = buildProgressPresentation(job, event, {
      now,
      resetByteHintsOnPathChange: false,
    });
    const nextStatus: TransferStatus =
      job.status === "queued" ? "running" : job.status;

    return {
      ...job,
      status: nextStatus,
      startedAt: job.status === "queued" ? now : job.startedAt,
      activityAt: now,
      currentPath: presentation.nextCurrentPath,
      currentBytes: presentation.nextCurrentBytes,
      currentTotalBytes: presentation.nextCurrentTotalBytes,
      progressPercent:
        presentation.pathChanged && event.progressPercent === undefined
          ? undefined
          : presentation.nextProgressPercent,
      statusText:
        presentation.pathChanged && event.statusText === undefined
          ? undefined
          : presentation.nextStatusText,
      rateText:
        presentation.pathChanged && event.rateText === undefined
          ? undefined
          : presentation.nextRateText,
      currentStartedAt: presentation.currentStartedAt,
    };
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
