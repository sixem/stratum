// Barrel exports for native API wrappers.
export type { DragOutcome } from "./drag";
export { startDrag } from "./drag";
export { copyPathsToClipboard, getClipboardPaths } from "./clipboard";
export { getShellAvailability, openShell } from "./shells";
export {
  copyEntries,
  deleteEntries,
  ensureDir,
  getDrives,
  getHome,
  getPlaces,
  listDir,
  listDirWithParent,
  listDriveInfo,
  parentDir,
  transferEntries,
  renameEntry,
  startDirWatch,
  statEntries,
  stopDirWatch,
} from "./fs";
export { openPath, openPathProperties } from "./opener";
export {
  clearThumbCache,
  getThumbCacheDir,
  getThumbCacheSize,
  requestThumbnails,
  setThumbPaused,
  toThumbnailUrl,
} from "./thumbs";
