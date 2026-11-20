// Tauri-backed filesystem API calls.
import { invoke } from "@tauri-apps/api/core";
import type {
  CopyOptions,
  CopyPlan,
  CopyReport,
  DeleteReport,
  DriveInfo,
  EntryMeta,
  FolderThumbSampleBatchOptions,
  FolderThumbSampleBatchResult,
  ListDirOptions,
  ListDirResult,
  ListDirWithParentResult,
  Place,
  RestoreRecycleReport,
  TransferMode,
  TransferQueueSnapshot,
  TransferReport,
  TrashReport,
} from "@/types";

export const getHome = () => invoke<string | null>("get_home");

export const getPlaces = () => invoke<Place[]>("get_places");

export const getDrives = () => invoke<string[]>("list_drives");

export const ensureDir = (path: string) => invoke<void>("ensure_dir", { path });

export const createFolder = (path: string) => invoke<void>("create_folder", { path });

export const createFile = (path: string) => invoke<void>("create_file", { path });

export const listDriveInfo = () => invoke<DriveInfo[]>("list_drive_info");

export const listDir = (path: string, options?: ListDirOptions) =>
  invoke<ListDirResult>("list_dir", { path, options });

export const listDirWithParent = (path: string, options?: ListDirOptions) =>
  invoke<ListDirWithParentResult>("list_dir_with_parent", { path, options });

export const statEntries = (paths: string[]) =>
  invoke<EntryMeta[]>("stat_entries", { paths });

export const listFolderThumbSamplesBatch = (
  folderPaths: string[],
  options: FolderThumbSampleBatchOptions,
) =>
  invoke<FolderThumbSampleBatchResult[]>("list_folder_thumb_samples_batch", {
    folderPaths,
    options,
  });

export const parentDir = (path: string) => invoke<string | null>("parent_dir", { path });

export const copyEntries = (
  paths: string[],
  destination: string,
  options?: CopyOptions,
  transferId?: string,
) => invoke<CopyReport>("copy_entries", { paths, destination, options, transferId });

export const planCopyEntries = (paths: string[], destination: string) =>
  invoke<CopyPlan>("plan_copy_entries", { paths, destination });

export const transferEntries = (
  paths: string[],
  destination: string,
  options?: { mode?: TransferMode; overwrite?: boolean; overwritePaths?: string[] },
  transferId?: string,
  dropStage?: number,
) =>
  invoke<TransferReport>("transfer_entries", {
    paths,
    destination,
    options,
    transferId,
    dropStage,
  });

export const listTransferJobs = () =>
  invoke<TransferQueueSnapshot>("list_transfer_jobs");

export const pauseTransferJob = (jobId: string) =>
  invoke<boolean>("pause_transfer_job", { jobId });

export const resumeTransferJob = (jobId: string) =>
  invoke<boolean>("resume_transfer_job", { jobId });

export const cancelTransferJob = (jobId: string) =>
  invoke<boolean>("cancel_transfer_job", { jobId });

export const deleteEntries = (paths: string[], transferId?: string) =>
  invoke<DeleteReport>("delete_entries", { paths, transferId });

export const trashEntries = (paths: string[], transferId?: string) =>
  invoke<TrashReport>("trash_entries", { paths, transferId });

export const restoreRecycleItems = (receiptId: string) =>
  invoke<RestoreRecycleReport>("restore_recycle_items", { receiptId });

export const renameEntry = (path: string, newName: string) =>
  invoke<string>("rename_entry", { path, newName });

// Blocking workers may finish out of order as navigation crosses slow drives.
let watchGeneration = 0;
const nextWatchGeneration = () => {
  watchGeneration = Math.max(Date.now(), watchGeneration + 1);
  return watchGeneration;
};

export const startDirWatch = (path: string, pane: "main" | "bottom" = "main") =>
  invoke<void>("start_dir_watch", { path, pane, generation: nextWatchGeneration() });

export const stopDirWatch = (pane: "main" | "bottom" = "main") =>
  invoke<void>("stop_dir_watch", { pane, generation: nextWatchGeneration() });
