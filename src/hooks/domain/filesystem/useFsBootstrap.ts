// Startup filesystem bootstrap for places/drives and drive metadata.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getDrives,
  getIndexedSearchSnapshot,
  getPlaces,
  listDriveInfo,
} from "@/api";
import {
  isVisibleDriveInfo,
  normalizePath,
  shouldPollIndexedSearch,
  toMessage,
} from "@/lib";
import type { DriveInfo, IndexedDriveStatus, IndexedSearchServiceStatus, Place } from "@/types";

const INDEXED_SEARCH_STATUS_POLL_MS = 4000;

type UseFsBootstrapOptions = {
  reportError: (title: string, message: string) => void;
};

export const useFsBootstrap = ({
  reportError,
}: UseFsBootstrapOptions) => {
  const [places, setPlaces] = useState<Place[]>([]);
  const [placesLoaded, setPlacesLoaded] = useState(false);
  const [listedDrives, setListedDrives] = useState<string[] | null>(null);
  const [driveMetadata, setDriveMetadata] = useState<DriveInfo[] | null>(null);
  const [initialDriveInfoSettled, setInitialDriveInfoSettled] = useState(false);
  const [indexedDrives, setIndexedDrives] = useState<IndexedDriveStatus[]>([]);
  const [indexedSearchStatus, setIndexedSearchStatus] =
    useState<IndexedSearchServiceStatus | null>(null);
  // A slow drive or share can delay space and label probes. Show the
  // available drive letters immediately and enrich them as replies arrive.
  const visibleDriveMetadata = useMemo(
    () => driveMetadata?.filter(isVisibleDriveInfo),
    [driveMetadata],
  );
  const drives = useMemo(
    () => visibleDriveMetadata?.map((info) => info.path) ?? listedDrives ?? [],
    [listedDrives, visibleDriveMetadata],
  );
  const driveInfo = useMemo(() => {
    const statuses = new Map(indexedDrives.map((status) => [normalizePath(status.drivePath), status]));
    const info = visibleDriveMetadata ?? drives.map((path) => ({ path, free: null, total: null }));
    return info.map((drive) => ({
      ...drive,
      indexStatus: statuses.get(normalizePath(drive.path)) ?? null,
    }));
  }, [drives, indexedDrives, visibleDriveMetadata]);
  const pollIndexedSearch = shouldPollIndexedSearch(indexedSearchStatus, driveInfo);

  const applyIndexSnapshot = useCallback(
    ([service, statuses]: Awaited<ReturnType<typeof getIndexedSearchSnapshot>>) => {
      if (service.status === "fulfilled") setIndexedSearchStatus(service.value);
      if (statuses.status === "fulfilled") setIndexedDrives(statuses.value);
    },
    [],
  );

  const refreshDriveInfo = useCallback(async () => {
    await Promise.allSettled([
      listDriveInfo().then(setDriveMetadata),
      getIndexedSearchSnapshot().then(applyIndexSnapshot),
    ]);
  }, [applyIndexSnapshot]);

  useEffect(() => {
    let active = true;

    void getPlaces().then(
      (items) => { if (active) setPlaces(items); },
      (error) => { if (active) reportError("Couldn't start", `Failed to load places: ${toMessage(error, "unknown error")}`); },
    ).finally(() => { if (active) setPlacesLoaded(true); });
    void getDrives().then(
      (paths) => { if (active) setListedDrives(paths); },
      () => { if (active) setListedDrives([]); },
    );
    void listDriveInfo().then((info) => {
      if (active) setDriveMetadata((current) => current ?? info);
    }).catch(() => { /* Drive letters remain available. */ })
      .finally(() => { if (active) setInitialDriveInfoSettled(true); });
    void getIndexedSearchSnapshot().then((snapshot) => {
      if (active) applyIndexSnapshot(snapshot);
    }).catch(() => { /* Index reporting can retry independently of drives. */ });

    return () => {
      active = false;
    };
  }, [applyIndexSnapshot, reportError]);

  useEffect(() => {
    if (!pollIndexedSearch) {
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const snapshot = await getIndexedSearchSnapshot();
        if (active) applyIndexSnapshot(snapshot);
      } catch {
        // Keep the most recent snapshot if the service is temporarily unavailable.
      } finally {
        if (active) timer = window.setTimeout(poll, INDEXED_SEARCH_STATUS_POLL_MS);
      }
    };
    let timer = window.setTimeout(poll, INDEXED_SEARCH_STATUS_POLL_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [applyIndexSnapshot, pollIndexedSearch]);

  return {
    places,
    placesLoaded,
    drives,
    drivesLoaded: listedDrives !== null || driveMetadata !== null,
    driveInfoLoaded: driveMetadata !== null || initialDriveInfoSettled,
    driveInfo,
    indexedSearchStatus,
    refreshDriveInfo,
  };
};
