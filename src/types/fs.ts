import type { SortState } from "./sort";
import type { IndexedDriveStatus } from "./indexedSearch";

export type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  modified: number | null;
};

export type ListDirOptions = {
  sort?: SortState;
  search?: string;
  fast?: boolean;
  // Optional request generation so the backend can cancel stale scans.
  generation?: number;
  pane?: "main" | "bottom";
};

export type ListDirResult = {
  entries: FileEntry[];
  totalCount: number;
};

export type ListDirWithParentResult = {
  entries: FileEntry[];
  totalCount: number;
  parentPath: string | null;
};

export type Place = {
  name: string;
  path: string;
  // Pinned places are shown before normal places in sidebar lists.
  pinned?: boolean;
};

export type EntryMeta = {
  path: string;
  size: number | null;
  modified: number | null;
};

export type FolderThumbSampleBatchOptions = {
  allowVideos: boolean;
  allowSvgs: boolean;
};

export type FolderThumbSampleBatchResult = {
  folderPath: string;
  samplePath: string | null;
  status: "ok" | "empty" | "error";
};

export type DriveInfo = {
  path: string;
  free: number | null;
  total: number | null;
  label?: string | null;
  // Frontend-only joined state from the indexed-search service.
  indexStatus?: IndexedDriveStatus | null;
};

export type CopyReport = {
  copied: number;
  skipped: number;
  failures: string[];
};

export type CopyConflictKind =
  | "fileToFile"
  | "fileToDirectory"
  | "directoryToFile";

export type CopyConflict = {
  sourcePath: string;
  destinationPath: string;
  kind: CopyConflictKind;
};

export type CopyPlan = {
  conflicts: CopyConflict[];
};

export type CopyOptions = {
  overwritePaths?: string[];
  skipPaths?: string[];
};

export type TransferMode = "copy" | "move" | "auto";

export type MovedTransferEntry = {
  sourcePath: string;
  destinationPath: string;
};

export type TransferReport = {
  copied: number;
  moved: number;
  skipped: number;
  cancelled: boolean;
  failures: string[];
  movedEntries: MovedTransferEntry[];
};

export type TransferJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type TransferJobKind =
  | "transfer"
  | "copy"
  | "move"
  | "delete"
  | "trash"
  | "conversion";

export type TransferJobPhase = "planning" | "ready" | "executing" | "finalizing";

export type TransferJobCapabilities = {
  canPause: boolean;
  canCancel: boolean;
};

export type TransferWorkEstimate = {
  rootsTotal: number;
  rootsCompleted: number;
  filesTotal?: number | null;
  filesCompleted: number;
  bytesTotal?: number | null;
  bytesCompleted: number;
};

export type TransferJobSnapshot = {
  id: string;
  kind: TransferJobKind;
  status: TransferJobStatus;
  phase: TransferJobPhase;
  capabilities: TransferJobCapabilities;
  currentPath?: string | null;
  work: TransferWorkEstimate;
};

export type TransferQueueSnapshot = {
  revision: number;
  activeJobs: TransferJobSnapshot[];
  queuedJobs: TransferJobSnapshot[];
  completedJobs: TransferJobSnapshot[];
};

// Emitted while a copy/move operation progresses.
export type TransferProgressEvent = {
  id: string;
  processed: number;
  total: number;
  currentPath?: string | null;
  currentBytes?: number | null;
  currentTotalBytes?: number | null;
  progressPercent?: number | null;
  statusText?: string | null;
  rateText?: string | null;
  completedItem?: { path: string; sourceRemoved: boolean };
};

export type TransferJobsSnapshotEvent = TransferQueueSnapshot;

export type DeleteReport = {
  deleted: number;
  skipped: number;
  cancelled: boolean;
  failures: string[];
};

export type TrashReport = {
  deleted: number;
  skipped: number;
  cancelled: boolean;
  failures: string[];
  failedPaths: string[];
  recycleUndoReceipt: string | null;
};

export type RestoreRecycleReport = {
  restoredPaths: string[];
  failures: string[];
  canRetry: boolean;
};

// Emitted when the native watcher detects a change in a watched directory.
export type DirChangedEvent = {
  path: string;
  // Paths reported by the native watcher (when available).
  paths?: string[];
};

// Emitted when the native watcher detects a rename in a watched directory.
export type DirRenameEvent = {
  path: string;
  from: string;
  to: string;
  // Paths reported by the native watcher (when available).
  paths?: string[];
};
