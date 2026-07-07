import type {
  DriveInfo,
  IndexedDriveState,
  IndexedDriveStatus,
  IndexedSearchServiceStatus,
} from "@/types";
import { normalizePath } from "./paths";

const ACTIVE_DRIVE_STATES = new Set<IndexedDriveState>(["queued", "scanning"]);

export const isVisibleDriveInfo = (info: DriveInfo) => info.total != null && info.free != null;

export const filterVisibleIndexedDriveStatuses = (
  driveInfo: DriveInfo[],
  driveStatuses: IndexedDriveStatus[],
) => {
  const visibleDriveKeys = new Set(
    driveInfo
      .filter(isVisibleDriveInfo)
      .map((info) => normalizePath(info.path))
      .filter((value) => value.length > 0),
  );

  return driveStatuses.filter((status) => visibleDriveKeys.has(normalizePath(status.drivePath)));
};

export const isIndexedDriveActiveState = (
  state: IndexedDriveState | null | undefined,
) => state != null && ACTIVE_DRIVE_STATES.has(state);

export const formatIndexedDriveState = (state: IndexedDriveState) => {
  switch (state) {
    case "queued":
      return "Queued";
    case "scanning":
      return "Scanning";
    case "ready":
      return "Ready";
    case "unsupported":
      return "Unsupported";
    case "unavailable":
      return "Unavailable";
    case "stale":
      return "Stale";
    case "rescanrequired":
      return "Rescan required";
    case "error":
      return "Error";
    default:
      return "Unknown";
  }
};

export const formatIndexedDriveSourceLabel = (
  sourceLabel: string | null | undefined,
) => {
  if (!sourceLabel) return null;

  const normalized = sourceLabel.trim().toLowerCase();
  if (normalized === "ntfs fast path") {
    return "NTFS";
  }
  if (normalized === "recursive fallback") {
    return "SCAN";
  }

  return sourceLabel;
};

export const formatIndexedDriveSummary = (status: IndexedDriveStatus) => {
  if (status.entryCount == null) {
    return null;
  }

  const countLabel = `${new Intl.NumberFormat().format(status.entryCount)} entr${
    status.entryCount === 1 ? "y" : "ies"
  }`;
  const sourceLabel = formatIndexedDriveSourceLabel(status.sourceLabel);
  return sourceLabel ? `${sourceLabel}: ${countLabel}` : countLabel;
};

export const formatIndexedSearchServiceState = (
  status: IndexedSearchServiceStatus | null,
) => {
  if (!status) return "Unavailable";

  switch (status.state) {
    case "disabled":
      return "Disabled";
    case "starting":
      return "Starting";
    case "scanning":
      return "Scanning";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
};

export const shouldPollIndexedSearch = (
  status: IndexedSearchServiceStatus | null,
  driveInfo: DriveInfo[],
) => {
  if (!status) {
    return driveInfo.length > 0;
  }

  if (status.state === "disabled") {
    return false;
  }

  if (status.state === "starting" || status.state === "scanning") {
    return true;
  }

  return driveInfo.some((info) => isIndexedDriveActiveState(info.indexStatus?.state));
};
