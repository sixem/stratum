// Startup filesystem bootstrap for places/drives and drive metadata.
import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  getDrives,
  getIndexedSearchStatus,
  getPlaces,
  listDriveInfo,
  listIndexedDriveStatuses,
} from "@/api";
import {
  isVisibleDriveInfo,
  normalizePath,
  shouldPollIndexedSearch,
  toMessage,
} from "@/lib";
import type { DriveInfo, IndexedDriveStatus, IndexedSearchServiceStatus, Place } from "@/types";
import type { StatusState } from "./fileManager.types";

const INDEXED_SEARCH_STATUS_POLL_MS = 4000;

type UseFsBootstrapOptions = {
  setLoading: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<StatusState>>;
  reportError: (title: string, message: string) => void;
};

export const useFsBootstrap = ({
  setLoading,
  setStatus,
  reportError,
}: UseFsBootstrapOptions) => {
  const [places, setPlaces] = useState<Place[]>([]);
  const [placesLoaded, setPlacesLoaded] = useState(false);
  const [drives, setDrives] = useState<string[]>([]);
  const [driveInfo, setDriveInfo] = useState<DriveInfo[]>([]);
  const [indexedSearchStatus, setIndexedSearchStatus] =
    useState<IndexedSearchServiceStatus | null>(null);
  const pollIndexedSearch = shouldPollIndexedSearch(indexedSearchStatus, driveInfo);

  const mergeDriveInfoWithIndexStatus = useCallback(
    (driveInfoList: DriveInfo[], driveStatuses: IndexedDriveStatus[]) => {
      const indexStatusByDrive = new Map<string, IndexedDriveStatus>();
      driveStatuses.forEach((status) => {
        const key = normalizePath(status.drivePath);
        if (!key) return;
        indexStatusByDrive.set(key, status);
      });

      return driveInfoList.map((info) => {
        const key = normalizePath(info.path);
        return {
          ...info,
          indexStatus: key ? indexStatusByDrive.get(key) ?? null : null,
        };
      });
    },
    [],
  );

  const resolveVisibleDriveState = useCallback(
    (driveList: string[], driveInfoList: DriveInfo[], driveStatuses: IndexedDriveStatus[]) => {
      const mergedDriveInfo = mergeDriveInfoWithIndexStatus(driveInfoList, driveStatuses);
      const visibleDriveInfo = mergedDriveInfo.filter(isVisibleDriveInfo);
      const visibleDriveKeys = new Set(
        visibleDriveInfo
          .map((info) => normalizePath(info.path))
          .filter((value) => value.length > 0),
      );

      const driveCandidates = driveList.length > 0 ? driveList : visibleDriveInfo.map((item) => item.path);
      const visibleDrives = driveCandidates.filter((drive) =>
        visibleDriveKeys.has(normalizePath(drive)),
      );

      return {
        driveInfo: visibleDriveInfo,
        drives: visibleDrives.length > 0 ? visibleDrives : visibleDriveInfo.map((item) => item.path),
      };
    },
    [mergeDriveInfoWithIndexStatus],
  );

  const refreshIndexedSearchSnapshot = useCallback(async () => {
    const [serviceStatus, driveStatuses] = await Promise.all([
      getIndexedSearchStatus().catch(() => null),
      listIndexedDriveStatuses().catch(() => []),
    ]);

    setDriveInfo((current) => mergeDriveInfoWithIndexStatus(current, driveStatuses));
    if (serviceStatus) {
      setIndexedSearchStatus(serviceStatus);
    }
  }, [mergeDriveInfoWithIndexStatus]);

  const refreshDriveInfo = useCallback(async () => {
    try {
      const [info, serviceStatus, driveStatuses] = await Promise.all([
        listDriveInfo(),
        getIndexedSearchStatus().catch(() => null),
        listIndexedDriveStatuses().catch(() => []),
      ]);
      const nextState = resolveVisibleDriveState([], info, driveStatuses);
      setDriveInfo(nextState.driveInfo);
      setDrives(nextState.drives);
      if (serviceStatus) {
        setIndexedSearchStatus(serviceStatus);
      }
    } catch {
      // Ignore drive info errors; we'll keep the last known state.
    }
  }, [resolveVisibleDriveState]);

  useEffect(() => {
    let active = true;

    const init = async () => {
      setLoading(true);
      setStatus({ level: "loading", message: "Loading locations" });

      try {
        const [
          placesResult,
          drivesResult,
          driveInfoResult,
          indexedSearchStatusResult,
          indexedDriveStatusesResult,
        ] = await Promise.allSettled([
          getPlaces(),
          getDrives(),
          listDriveInfo(),
          getIndexedSearchStatus(),
          listIndexedDriveStatuses(),
        ]);
        const placeList = placesResult.status === "fulfilled" ? placesResult.value : [];
        const driveList = drivesResult.status === "fulfilled" ? drivesResult.value : [];
        const driveInfoList =
          driveInfoResult.status === "fulfilled" ? driveInfoResult.value : [];
        const nextIndexedSearchStatus =
          indexedSearchStatusResult.status === "fulfilled"
            ? indexedSearchStatusResult.value
            : null;
        const indexedDriveStatuses =
          indexedDriveStatusesResult.status === "fulfilled"
            ? indexedDriveStatusesResult.value
            : [];
        const nextState = resolveVisibleDriveState(
          driveList,
          driveInfoList,
          indexedDriveStatuses,
        );
        if (!active) return;
        setPlaces(placeList);
        setDriveInfo(nextState.driveInfo);
        setIndexedSearchStatus(nextIndexedSearchStatus);
        setDrives(nextState.drives);

        if (!active) return;
        setStatus({ level: "idle", message: "Ready" });
        setLoading(false);
        setPlacesLoaded(true);
      } catch (error) {
        if (!active) return;
        reportError(
          "Couldn't start",
          `Failed to load places: ${toMessage(error, "unknown error")}`,
        );
        setStatus({ level: "idle", message: "Ready" });
        setLoading(false);
        setPlacesLoaded(true);
      }
    };

    init();
    return () => {
      active = false;
    };
  }, [reportError, resolveVisibleDriveState, setLoading, setStatus]);

  useEffect(() => {
    if (!pollIndexedSearch) {
      return;
    }

    // Poll the lightweight indexed-search snapshot so drive/tool status stays
    // fresh while the background catalog build is running.
    const intervalId = window.setInterval(() => {
      void refreshIndexedSearchSnapshot();
    }, INDEXED_SEARCH_STATUS_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [pollIndexedSearch, refreshIndexedSearchSnapshot]);

  return {
    places,
    placesLoaded,
    drives,
    driveInfo,
    indexedSearchStatus,
    refreshDriveInfo,
  };
};
