// System-level runtime checks surfaced to the frontend settings UI.
import { invoke } from "@tauri-apps/api/core";
import type { IndexingRuntimeMode } from "@/types";

export type IndexingLaunchPreferences = {
  indexedSearchEnabled: boolean;
  acceleratedNtfsIndexing: boolean;
};

export const getIndexingRuntimeMode = () =>
  invoke<IndexingRuntimeMode>("get_indexing_runtime_mode");

export const getIndexingLaunchPreferences = () =>
  invoke<IndexingLaunchPreferences>("get_indexing_launch_preferences");

export const setIndexingLaunchPreferences = (preferences: IndexingLaunchPreferences) =>
  invoke<void>("set_indexing_launch_preferences", { preferences });

export const restartAsAdministrator = () =>
  invoke<void>("restart_as_administrator");
