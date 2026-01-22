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
    const currentDrive = activeDrive(currentPath, drives);
    if (!currentDrive) return undefined;
    const key = normalizePath(currentDrive);
    if (!key) return undefined;
    return driveInfoMap.get(key);
  }, [currentPath, drives, driveInfoMap]);

  return { driveInfoMap, currentDriveInfo };
};
