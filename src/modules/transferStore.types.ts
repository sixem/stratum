// Shared transfer store types.
// Keeping the shapes in one small module lets reducers and selectors stay pure.
import type { TransferJobCapabilities, TransferJobKind, TransferJobPhase } from "@/types";

export type TransferStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type TransferThroughputSample = {
  recordedAt: number;
  processed: number;
  bytesCompleted: number;
};

export const NO_TRANSFER_CONTROLS: TransferJobCapabilities = {
  canPause: false,
  canCancel: false,
};

export type TransferJob = {
  id: string;
  label: string;
  kind: TransferJobKind;
  backendManaged: boolean;
  capabilities: TransferJobCapabilities;
  status: TransferStatus;
  phase: TransferJobPhase;
  total: number;
  processed: number;
  startedAt: number;
  activityAt: number;
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

export type TransferJobRegistration = {
  id: string;
};

export type TransferJobMetadata = {
  label: string;
  items?: string[];
  copied?: number;
  moved?: number;
  skipped?: number;
  failures?: number;
};

export type TransferStoreState = {
  backendJobs: TransferJob[];
  localJobs: TransferJob[];
  jobMetadata: Record<string, TransferJobMetadata>;
  dismissedJobIds: Record<string, true>;
};
