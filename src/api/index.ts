// Barrel exports for native API wrappers.
export type { DragOutcome } from "./drag";
export { startDrag } from "./drag";
export { copyPathsToClipboard, getClipboardPaths } from "./clipboard";
export { getShellAvailability, openShell } from "./shells";
export {
  copyEntries,
  createFile,
  createFolder,
  deleteEntries,
  ensureDir,
  getDrives,
  getHome,
  getPlaces,
  listDir,
  listDirWithParent,
  listDriveInfo,
  listFolderThumbSamplesBatch,
  parentDir,
  restoreRecycleEntries,
  restoreRecyclePaths,
  transferEntries,
  renameEntry,
  startDirWatch,
  statEntries,
  stopDirWatch,
  trashEntries,
} from "./fs";
export {
  listOpenWithHandlers,
  openPath,
  openPathProperties,
  openPathWithDialog,
  openPathWithHandler,
} from "./opener";
export { convertImage, getImageInfo } from "./images";
export { convertVideo } from "./videos";
export { getFileIcons, toFileIconUrl } from "./fileIcons";
export {
  clearThumbCache,
  getThumbCacheDir,
  getThumbCacheSize,
  requestThumbnails,
  setThumbPaused,
  toThumbnailUrl,
} from "./thumbs";
