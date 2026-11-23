import type { BatchRenamePreset } from "../batchRenamePresetStore";
import type { QuickMovePreferences } from "../quickMovePreferences";
import type { Settings } from "../settings.types";
import type { Workspace, WorkspaceLayout, WorkspaceSession } from "../workspaceStore";

export const BACKUP_FORMAT = "stratum.backup";
export const BACKUP_VERSION = 1;

export type BackupWorkspace = Workspace & {
  draft?: WorkspaceLayout;
  recentMoves: readonly string[];
  quickMove?: QuickMovePreferences;
};

export type BackupProfile = {
  settings: Omit<Settings, "ffmpegPath">;
  settingsVersion: number;
  renamePresets: BatchRenamePreset[];
  current: WorkspaceSession;
  previous: WorkspaceSession | null;
  unnamedRecentMoves: readonly string[];
  unnamedQuickMove?: QuickMovePreferences;
  panePreferences: { defaultViewMode: "list" | "thumbs"; showBreadcrumbs: boolean };
  previewPreferences: { volume: number; stripOpen: boolean };
};

type BackupHeader = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  workspaces: BackupWorkspace[];
};

export type StratumBackup = BackupHeader & (
  | { scope: "full"; profile: BackupProfile }
  | { scope: "workspaces" }
);
