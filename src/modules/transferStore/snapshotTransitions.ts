// Queue-snapshot transitions.
// Snapshot reconciliation stays separate from progress hints so the backend contract is easier to follow.
import type {
  TransferJobPhase,
  TransferJobSnapshot,
  TransferJobsSnapshotEvent,
  TransferQueueSnapshot,
} from "@/types";
import { selectTransferJobs } from "../transferStore.selectors";
import type {
  TransferJob,
  TransferJobMetadata,
  TransferStatus,
  TransferStoreState,
} from "../transferStore.types";
import {
  buildThroughputSamples,
  getDefaultJobLabel,
  isActiveStatus,
  isTerminalStatus,
} from "./shared";

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
