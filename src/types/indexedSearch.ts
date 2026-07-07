export type IndexedSearchServiceState = "disabled" | "starting" | "scanning" | "idle" | "error";

export type IndexedSearchServiceStatus = {
  state: IndexedSearchServiceState;
  activityLabel?: string | null;
  startedAt: number;
  lastUpdatedAt: number;
  driveCount: number;
  indexableDriveCount: number;
};

export type IndexedDriveState =
  | "unknown"
  | "queued"
  | "scanning"
  | "ready"
  | "unsupported"
  | "unavailable"
  | "stale"
  | "rescanrequired"
  | "error";

export type IndexedDriveStatus = {
  drivePath: string;
  filesystem?: string | null;
  state: IndexedDriveState;
  indexable: boolean;
  startedAt?: number | null;
  lastUpdatedAt: number;
  entryCount?: number | null;
  sourceLabel?: string | null;
  message?: string | null;
};

export type IndexedEntryKind = "file" | "directory";

export type IndexedPathMatch = {
  path: string;
  name: string;
  parentPath?: string | null;
  drivePath?: string | null;
  kind: IndexedEntryKind;
};

export type IndexedPathQuery = {
  query: string;
  limit?: number;
};
