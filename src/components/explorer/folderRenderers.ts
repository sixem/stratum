import { lazy } from "react";

export const loadFileList = () => import("./FileList");
export const loadFileGrid = () => import("./FileGrid");
export const FileList = lazy(loadFileList);
export const FileGrid = lazy(loadFileGrid);
