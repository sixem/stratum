// System-level runtime checks surfaced to the frontend settings UI.
import { invoke } from "@tauri-apps/api/core";

export type IndexingLaunchPreferences = {
  indexedSearchEnabled: boolean;
};

export const getIndexingLaunchPreferences = () =>
  invoke<IndexingLaunchPreferences>("get_indexing_launch_preferences");

export const setIndexingLaunchPreferences = (preferences: IndexingLaunchPreferences) =>
  invoke<void>("set_indexing_launch_preferences", { preferences });
