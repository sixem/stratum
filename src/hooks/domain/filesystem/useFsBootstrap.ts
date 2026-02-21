// Startup filesystem bootstrap for places/drives and drive metadata.
import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getDrives, getPlaces, listDriveInfo } from "@/api";
import { toMessage } from "@/lib";
import type { DriveInfo, Place } from "@/types";
import type { StatusState } from "./fileManager.types";

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

  const refreshDriveInfo = useCallback(async () => {
    try {
      const info = await listDriveInfo();
      setDriveInfo(info);
    } catch {
      // Ignore drive info errors; we'll keep the last known state.
    }
  }, []);

  useEffect(() => {
    let active = true;

    const init = async () => {
      setLoading(true);
      setStatus({ level: "loading", message: "Loading locations" });

      try {
        const [placesResult, drivesResult, driveInfoResult] = await Promise.allSettled([
          getPlaces(),
          getDrives(),
          listDriveInfo(),
        ]);
        const placeList = placesResult.status === "fulfilled" ? placesResult.value : [];
        const driveList = drivesResult.status === "fulfilled" ? drivesResult.value : [];
        const driveInfoList =
          driveInfoResult.status === "fulfilled" ? driveInfoResult.value : [];
        const resolvedDrives =
          driveList.length > 0 ? driveList : driveInfoList.map((item) => item.path);
        if (!active) return;
        setPlaces(placeList);
        setDriveInfo(driveInfoList);
        setDrives(resolvedDrives);

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
  }, [reportError, setLoading, setStatus]);

  return {
    places,
    placesLoaded,
    drives,
    driveInfo,
    refreshDriveInfo,
  };
};
