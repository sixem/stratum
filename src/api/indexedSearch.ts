// Tauri-backed indexed-search API calls.
import { invoke } from "@tauri-apps/api/core";
import type {
  IndexedDriveStatus,
  IndexedPathMatch,
  IndexedPathQuery,
  IndexedSearchServiceStatus,
} from "@/types";

export const getIndexedSearchStatus = () =>
  invoke<IndexedSearchServiceStatus>("get_indexed_search_status");

export const setIndexedSearchEnabled = (enabled: boolean) =>
  invoke<void>("set_indexed_search_enabled", { enabled });

export const getIndexedSearchCatalogPath = () =>
  invoke<string>("get_indexed_search_catalog_path");

export const listIndexedDriveStatuses = () =>
  invoke<IndexedDriveStatus[]>("list_indexed_drive_statuses");

export const queryIndexedPaths = (query: IndexedPathQuery) =>
  invoke<IndexedPathMatch[]>("query_indexed_paths", { query });

export const rebuildIndexedDrive = (drivePath: string) =>
  invoke<boolean>("rebuild_indexed_drive", { drivePath });
