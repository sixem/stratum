// Backend status lifecycle for the indexed-search modal.
//
// This hook owns drive discovery, service polling, visible-drive filtering, and
// rebuild requests. The modal shell can read the current snapshot without also
// knowing how it is refreshed.
import { useCallback, useEffect, useState } from "react";

import {
  getIndexedSearchStatus,
  listDriveInfo,
  listIndexedDriveStatuses,
  rebuildIndexedDrive,
} from "@/api";
import { filterVisibleIndexedDriveStatuses, isIndexedDriveActiveState } from "@/lib";
import type {
  DriveInfo,
  IndexedDriveStatus,
  IndexedSearchServiceStatus,
} from "@/types";
import { INDEXED_SEARCH_MODAL_POLL_MS } from "./indexedSearchModalConfig";

type IndexedSearchStatusSnapshot = {
  driveStatuses?: IndexedDriveStatus[];
  serviceStatus?: IndexedSearchServiceStatus | null;
  statusError: string | null;
};

export const useIndexedSearchStatus = (open: boolean) => {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [serviceStatus, setServiceStatus] =
    useState<IndexedSearchServiceStatus | null>(null);
  const [driveStatuses, setDriveStatuses] = useState<IndexedDriveStatus[]>([]);
  const [visibleDriveInfo, setVisibleDriveInfo] = useState<DriveInfo[] | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [rebuildingDrivePath, setRebuildingDrivePath] = useState<string | null>(null);

  const shouldPollSnapshot =
    serviceStatus == null ||
    serviceStatus.state === "starting" ||
    serviceStatus.state === "scanning" ||
    driveStatuses.some((status) => isIndexedDriveActiveState(status.state));

  useEffect(() => {
    if (!open || visibleDriveInfo != null) return;
    let active = true;

    void listDriveInfo()
      .then((driveInfo) => {
        if (!active) return;
        setVisibleDriveInfo(driveInfo);
      })
      .catch(() => {
        if (!active) return;
        setVisibleDriveInfo([]);
      });

    return () => {
      active = false;
    };
  }, [open, visibleDriveInfo]);

  const loadStatusSnapshot = useCallback(async (): Promise<IndexedSearchStatusSnapshot> => {
    const [serviceResult, drivesResult] = await Promise.allSettled([
      getIndexedSearchStatus(),
      listIndexedDriveStatuses(),
    ]);

    return {
      serviceStatus:
        serviceResult.status === "fulfilled" ? serviceResult.value : undefined,
      driveStatuses:
        drivesResult.status === "fulfilled" && visibleDriveInfo != null
          ? filterVisibleIndexedDriveStatuses(visibleDriveInfo, drivesResult.value)
          : undefined,
      statusError:
        serviceResult.status === "rejected" && drivesResult.status === "rejected"
          ? "Indexed-search status is currently unavailable."
          : null,
    };
  }, [visibleDriveInfo]);

  useEffect(() => {
    if (open) return;

    setStatusError(null);
    setStatusLoading(false);
    setRebuildingDrivePath(null);
  }, [open]);

  useEffect(() => {
    if (!open || !shouldPollSnapshot) return;
    const intervalId = window.setInterval(() => {
      setRefreshVersion((value) => value + 1);
    }, INDEXED_SEARCH_MODAL_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [open, shouldPollSnapshot]);

  useEffect(() => {
    if (!open || visibleDriveInfo == null) return;
    let active = true;
    setStatusLoading(true);
    setStatusError(null);

    void loadStatusSnapshot()
      .then((snapshot) => {
        if (!active) return;
        if (snapshot.serviceStatus !== undefined) {
          setServiceStatus(snapshot.serviceStatus);
        }
        if (snapshot.driveStatuses !== undefined) {
          setDriveStatuses(snapshot.driveStatuses);
        }
        setStatusError(snapshot.statusError);
      })
      .catch(() => {
        if (!active) return;
        setStatusError("Indexed-search status is currently unavailable.");
      })
      .finally(() => {
        if (!active) return;
        setStatusLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadStatusSnapshot, open, refreshVersion, visibleDriveInfo]);

  const handleRebuildDrive = useCallback(async (drivePath: string) => {
    setRebuildingDrivePath(drivePath);
    setStatusError(null);
    try {
      await rebuildIndexedDrive(drivePath);
      setRefreshVersion((value) => value + 1);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start indexed-search rebuild.";
      setStatusError(message);
    } finally {
      setRebuildingDrivePath(null);
    }
  }, []);

  return {
    driveStatuses,
    handleRebuildDrive,
    rebuildingDrivePath,
    serviceStatus,
    shouldPollSnapshot,
    statusError,
    statusLoading,
    visibleDriveInfo,
  };
};
