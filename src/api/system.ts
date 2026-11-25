// System-level runtime checks surfaced to the frontend settings UI.
import { invoke } from "@tauri-apps/api/core";

export type IndexingLaunchPreferences = {
  indexedSearchEnabled: boolean;
};

export const getIndexingLaunchPreferences = () =>
  invoke<IndexingLaunchPreferences | null>("get_indexing_launch_preferences");

export const listTerminalFonts = () => invoke<string[]>("list_terminal_fonts");
