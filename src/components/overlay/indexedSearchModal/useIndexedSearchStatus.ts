// Poll the catalog revision and drive status while indexed search is open.
import { useCallback, useEffect, useRef, useState } from "react";

import { getIndexedSearchSnapshot, listDriveInfo, rebuildIndexedDrive } from "@/api";
import { toMessage } from "@/lib";
import type {
  DriveInfo,
  IndexedDriveStatus,
  IndexedSearchServiceStatus,
} from "@/types";
import {
  INDEXED_SEARCH_DRIVE_INFO_REFRESH_MS,
  INDEXED_SEARCH_MODAL_POLL_MS,
} from "./indexedSearchModalConfig";

// Schedule the next poll only after the current request settles.
const startPolling = (
  interval: number,
  refresh: (signal: AbortSignal) => Promise<void>,
) => {
  const abort = new AbortController();
  let timer: number | undefined;

  const poll = async () => {
    await refresh(abort.signal);
    if (!abort.signal.aborted) timer = window.setTimeout(poll, interval);
  };

  void poll();
  return () => {
    abort.abort();
    window.clearTimeout(timer);
  };
};

export const useIndexedSearchStatus = (open: boolean) => {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [serviceStatus, setServiceStatus] =
    useState<IndexedSearchServiceStatus | null>(null);
  const [driveStatuses, setDriveStatuses] = useState<IndexedDriveStatus[]>([]);
  const [visibleDriveInfo, setVisibleDriveInfo] = useState<DriveInfo[] | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [rebuildingDrivePath, setRebuildingDrivePath] = useState<string | null>(null);
  const pendingDriveInfo = useRef<Promise<DriveInfo[]> | null>(null);

  // A mount change also changes the drive state or the start of that state.
  const driveMounts = driveStatuses
    .map(({ drivePath, filesystem, startedAt, state }) =>
      `${drivePath}:${filesystem ?? ""}:${startedAt ?? 0}:${state}`,
    )
    .join("\n");

  useEffect(() => {
    if (open) return;

    setStatusLoading(true);
    setServiceStatus(null);
    setDriveStatuses([]);
    setVisibleDriveInfo(null);
    setStatusError(null);
    setRebuildError(null);
    setRebuildingDrivePath(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    return startPolling(INDEXED_SEARCH_MODAL_POLL_MS, async (signal) => {
      try {
        const [service, drives] = await getIndexedSearchSnapshot();
        if (signal.aborted) return;

        if (service.status === "fulfilled") setServiceStatus(service.value);
        if (drives.status === "fulfilled") setDriveStatuses(drives.value);
        setStatusError(
          service.status === "rejected" && drives.status === "rejected"
            ? "Indexed-search status is currently unavailable."
            : null,
        );
      } catch {
        if (!signal.aborted) setStatusError("Indexed-search status is currently unavailable.");
      } finally {
        if (!signal.aborted) setStatusLoading(false);
      }
    });
  }, [open, refreshVersion]);

  useEffect(() => {
    if (!open) return;

    // Volume labels and free space are independent of the catalog revision.
    // Refresh them on reopen and mount changes without delaying catalog polls.
    return startPolling(INDEXED_SEARCH_DRIVE_INFO_REFRESH_MS, async (signal) => {
      const request = (pendingDriveInfo.current ??= Promise.resolve().then(listDriveInfo));
      try {
        const info = await request;
        if (!signal.aborted) setVisibleDriveInfo(info);
      } catch {
        // Keep the last drive details while a volume is temporarily unavailable.
      } finally {
        if (pendingDriveInfo.current === request) pendingDriveInfo.current = null;
      }
    });
  }, [driveMounts, open]);

  const handleRebuildDrive = useCallback(async (drivePath: string) => {
    setRebuildingDrivePath(drivePath);
    setRebuildError(null);
    try {
      await rebuildIndexedDrive(drivePath);
      setRefreshVersion((version) => version + 1);
    } catch (error) {
      setRebuildError(toMessage(error, "Couldn't start refreshing the index."));
    } finally {
      setRebuildingDrivePath(null);
    }
  }, []);

  return {
    driveStatuses,
    handleRebuildDrive,
    rebuildingDrivePath,
    serviceStatus,
    statusError: rebuildError ?? statusError,
    statusLoading,
    visibleDriveInfo,
  };
};
