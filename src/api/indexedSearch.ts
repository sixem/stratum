// Tauri-backed indexed-search API calls.
import { invoke } from "@tauri-apps/api/core";
import type {
  IndexedDriveStatus,
  IndexedPathMatch,
  IndexedPathPage,
  IndexedPathPageQuery,
  IndexedPathQuery,
  IndexedSearchServiceStatus,
} from "@/types";

const fetchIndexedSearchSnapshot = async () =>
  Promise.allSettled([
    invoke<IndexedSearchServiceStatus>("get_indexed_search_status"),
    invoke<IndexedDriveStatus[]>("list_indexed_drive_statuses"),
  ]);

let pendingSnapshot: ReturnType<typeof fetchIndexedSearchSnapshot> | undefined;

// The shell and modal can both request status while a scan is running.
// Share any in-flight pair of calls between them.
export const getIndexedSearchSnapshot = () => {
  pendingSnapshot ??= fetchIndexedSearchSnapshot().finally(() => {
    pendingSnapshot = undefined;
  });
  return pendingSnapshot;
};

export const setIndexedSearchEnabled = (enabled: boolean) =>
  invoke<void>("set_indexed_search_enabled", { enabled });

export const nudgeIndexedSearch = () => invoke<void>("nudge_indexed_search");

export const getIndexedSearchCatalogPath = () =>
  invoke<string>("get_indexed_search_catalog_path");

export const queryIndexedPaths = (query: IndexedPathQuery) =>
  invoke<IndexedPathMatch[]>("query_indexed_paths", { query });

export const queryIndexedPathPage = (query: IndexedPathPageQuery) =>
  invoke<IndexedPathPage>("query_indexed_path_page", { query });

export const rebuildIndexedDrive = (drivePath: string) =>
  invoke<boolean>("rebuild_indexed_drive", { drivePath });
