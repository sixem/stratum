// Tauri-backed filesystem API calls.
import { invoke } from "@tauri-apps/api/core";
import type {
  CopyReport,
  DeleteReport,
  DriveInfo,
  EntryMeta,
  ListDirOptions,
  ListDirResult,
  ListDirWithParentResult,
  Place,
  TransferMode,
  TransferReport,
} from "@/types";

export function getHome() {
  return invoke<string | null>("get_home");
}

export function getPlaces() {
  return invoke<Place[]>("get_places");
}

export function getDrives() {
  return invoke<string[]>("list_drives");
}

export function ensureDir(path: string) {
  return invoke<void>("ensure_dir", { path });
}

export function createFolder(path: string) {
  return invoke<void>("create_folder", { path });
}

export function createFile(path: string) {
  return invoke<void>("create_file", { path });
}

export function listDriveInfo() {
  return invoke<DriveInfo[]>("list_drive_info");
}

export function listDir(path: string, options?: ListDirOptions) {
  return invoke<ListDirResult>("list_dir", { path, options });
}

export function listDirWithParent(path: string, options?: ListDirOptions) {
  return invoke<ListDirWithParentResult>("list_dir_with_parent", { path, options });
}

export function statEntries(paths: string[]) {
  return invoke<EntryMeta[]>("stat_entries", { paths });
}

export function parentDir(path: string) {
  return invoke<string | null>("parent_dir", { path });
}

export function copyEntries(paths: string[], destination: string, transferId?: string) {
  return invoke<CopyReport>("copy_entries", { paths, destination, transferId });
}

export function transferEntries(
  paths: string[],
  destination: string,
  options?: { mode?: TransferMode; overwrite?: boolean },
  transferId?: string,
) {
  return invoke<TransferReport>("transfer_entries", {
    paths,
    destination,
    options,
    transferId,
  });
}

export function deleteEntries(paths: string[]) {
  return invoke<DeleteReport>("delete_entries", { paths });
}

export function renameEntry(path: string, newName: string) {
  return invoke<string>("rename_entry", { path, newName });
}

export function startDirWatch(path: string) {
  return invoke<void>("start_dir_watch", { path });
}

export function stopDirWatch() {
  return invoke<void>("stop_dir_watch");
}
