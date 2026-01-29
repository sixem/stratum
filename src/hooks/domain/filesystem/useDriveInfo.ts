// Derives drive metadata helpers from the file manager state.
import { useMemo } from "react";
import { activeDrive, normalizePath } from "@/lib";
import type { DriveInfo } from "@/types";

type UseDriveInfoOptions = {
  currentPath: string;
  drives: string[];
  driveInfo: DriveInfo[];
};

export const useDriveInfo = ({
  currentPath,
  drives,
  driveInfo,
}: UseDriveInfoOptions) => {
  const normalizedDrives = useMemo(
    () => drives.map((drive) => normalizePath(drive)).filter(Boolean) as string[],
    [drives],
  );
  const driveInfoMap = useMemo(() => {
    const map = new Map<string, DriveInfo>();
    driveInfo.forEach((info) => {
      const key = normalizePath(info.path);
      if (key) {
        map.set(key, info);
      }
    });
    return map;
  }, [driveInfo]);

  const currentDriveInfo = useMemo(() => {
    const currentDrive = activeDrive(currentPath, normalizedDrives);
    if (!currentDrive) return undefined;
    return driveInfoMap.get(currentDrive);
  }, [currentPath, normalizedDrives, driveInfoMap]);

  return { driveInfoMap, currentDriveInfo };
};
