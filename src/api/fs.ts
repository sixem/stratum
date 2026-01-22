// Tauri-backed filesystem API calls.
import { invoke } from "@tauri-apps/api/core";
import type { CopyReport, DeleteReport, DriveInfo, EntryMeta, FileEntry, Place } from "@/types";

export function getHome() {
  return invoke<string | null>("get_home");
}

export function getPlaces() {
  return invoke<Place[]>("get_places");
}

export function getDrives() {
  return invoke<string[]>("list_drives");
}

export function listDriveInfo() {
  return invoke<DriveInfo[]>("list_drive_info");
}

export function listDir(path: string) {
  return invoke<FileEntry[]>("list_dir", { path });
}

export function statEntries(paths: string[]) {
  return invoke<EntryMeta[]>("stat_entries", { paths });
}

export function parentDir(path: string) {
  return invoke<string | null>("parent_dir", { path });
}

export function copyEntries(paths: string[], destination: string) {
  return invoke<CopyReport>("copy_entries", { paths, destination });
}

export function deleteEntries(paths: string[]) {
  return invoke<DeleteReport>("delete_entries", { paths });
}
