// Barrel exports for native API wrappers.
export type { DragOutcome } from "./drag";
export { cancelDragStart, fileDropListenerReady, releaseDropStage, startDrag } from "./drag";
export { finishFileCut, getFileClipboard, setFileClipboard } from "./clipboard";
export {
  getIndexedSearchCatalogPath,
  getIndexedSearchSnapshot,
  setIndexedSearchEnabled,
  queryIndexedPaths,
  rebuildIndexedDrive,
} from "./indexedSearch";
export {
  getIndexingLaunchPreferences,
  setIndexingLaunchPreferences,
} from "./system";
export { getShellAvailability, openShell } from "./shells";
export { showShellContextMenu, type ShellMenuTarget } from "./shellContextMenu";
export {
  copyEntries,
  createFile,
  createFolder,
  deleteEntries,
  ensureDir,
  cancelTransferJob,
  getDrives,
  getHome,
  getPlaces,
  listTransferJobs,
  listDir,
  listDirWithParent,
  listDriveInfo,
  listFolderThumbSamplesBatch,
  parentDir,
  pauseTransferJob,
  planCopyEntries,
  restoreRecycleItems,
  resumeTransferJob,
  transferEntries,
  renameEntry,
  validateBatchRename,
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
export { getImageInfo } from "./images";
export { convertMediaEntries } from "./conversion";
export { getFileIcons, toFileIconUrl } from "./fileIcons";
export {
  clearThumbCache,
  getThumbCacheDir,
  getThumbCacheSize,
  requestThumbnails,
  setThumbPaused,
  toThumbnailUrl,
} from "./thumbs";
