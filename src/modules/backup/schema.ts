// Inspect an import completely before preparing any changes to the running app.
import { isRemoteLocation } from "@/lib/tabRestore";
import { SETTINGS_STORAGE_VERSION } from "@/constants";
import { clampVolume, DEFAULT_PREVIEW_VOLUME } from "@/lib/previewVolume";
import { readBatchRenamePresets } from "../batchRenamePresetStore";
import { coerceQuickMovePreferences } from "../quickMovePreferences";
import { coerceRememberedViewMode, coerceSettings, normalizeLegacySettings } from "../settings.normalize";
import type { Settings } from "../settings.types";
import { readWorkspaceLayout } from "../workspaceStore";
import type { WorkspaceLayout } from "../workspaceStore";
import { BACKUP_FORMAT, BACKUP_VERSION } from "./types";
import type { BackupProfile, BackupWorkspace, StratumBackup } from "./types";
import type { RemoteProfile } from "../remoteProfiles";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const pathString = (value: unknown): value is string => typeof value === "string" && !value.includes("\0");
const shellDescriptor = (value: unknown) => isRecord(value) && pathString(value.directory);

const invalidBackup = (): never => {
  throw new Error("This file doesn't contain a valid Stratum backup.");
};

const importRemoteHosts = (value: unknown): RemoteProfile[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100_000) return invalidBackup();
  const ids = new Set<string>();
  const destinations = new Set<string>();
  return value.map((item): RemoteProfile => {
    if (!isRecord(item) || typeof item.id !== "string" || !/^[\da-f-]{36}$/i.test(item.id) || ids.has(item.id) ||
      typeof item.destination !== "string" || item.destination.length > 255 || !/^[a-z\d._@:%\[\]-]+$/i.test(item.destination) ||
      item.destination.startsWith("-") || destinations.has(item.destination) ||
      typeof item.name !== "string" || item.name.length > 80 || item.name.includes("\0") ||
      typeof item.startPath !== "string" || item.startPath.length > 8192 || item.startPath.includes("\0")) return invalidBackup();
    ids.add(item.id);
    destinations.add(item.destination);
    return { id: item.id, destination: item.destination, name: item.name, startPath: item.startPath };
  });
};

const pathList = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.every(pathString)) return invalidBackup();
  return value;
};

const importQuickMove = (value: unknown) => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return invalidBackup();
  pathList(value.favorites);
  if (value.driveRoots !== null) pathList(value.driveRoots);
  if (value.maxDepth !== null &&
    (typeof value.maxDepth !== "number" || !Number.isSafeInteger(value.maxDepth) || value.maxDepth < 0)) return invalidBackup();
  return coerceQuickMovePreferences(value);
};

const checkSession = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return invalidBackup();
  const ids = new Set<string>();
  for (const tab of value.tabs) {
    if (!isRecord(tab) || typeof tab.id !== "string" || !tab.id || ids.has(tab.id) ||
      !pathString(tab.path) || (tab.crumbTrailPath !== undefined && !pathString(tab.crumbTrailPath))) {
      return invalidBackup();
    }
    if (tab.kind === "remote" && !isRemoteLocation(tab.remote)) return invalidBackup();
    if ((tab.kind === "terminal" || tab.terminal !== undefined) && !shellDescriptor(tab.terminal)) return invalidBackup();
    if (tab.split !== undefined && (!isRecord(tab.split) || !shellDescriptor(tab.split.terminal))) return invalidBackup();
    ids.add(tab.id);
  }
  if (value.recentJumps !== undefined) pathList(value.recentJumps);
};

const importLayout = (value: unknown): WorkspaceLayout => {
  if (!isRecord(value) || !isRecord(value.pane) || !isRecord(value.places) || !Array.isArray(value.places.places)) {
    return invalidBackup();
  }
  checkSession(value.main);
  checkSession(value.bottom);
  for (const place of value.places.places) {
    if (!isRecord(place) || !pathString(place.path)) return invalidBackup();
  }
  const link = value.pane.link;
  if (link != null && (!isRecord(link) || !pathString(link.mainRootPath) || !pathString(link.bottomRootPath))) {
    return invalidBackup();
  }
  const layout = readWorkspaceLayout(value as Partial<WorkspaceLayout>);
  if (!layout || (link != null && !layout.pane.link)) return invalidBackup();
  return layout;
};

const importProfile = (value: unknown, ids: ReadonlySet<string>): BackupProfile => {
  if (!isRecord(value) || !isRecord(value.settings) || !Array.isArray(value.renamePresets)) return invalidBackup();
  const { panePreferences, previewPreferences, settingsVersion } = value;
  if (!isRecord(panePreferences) || !isRecord(previewPreferences) ||
    typeof settingsVersion !== "number" || !Number.isInteger(settingsVersion)) return invalidBackup();

  const importSession = (session: unknown) => {
    if (!isRecord(session) || (session.id !== null && (typeof session.id !== "string" || !ids.has(session.id)))) {
      return invalidBackup();
    }
    return { id: session.id, layout: importLayout(session.layout) };
  };
  const renamePresets = readBatchRenamePresets(value.renamePresets);
  if (renamePresets.length !== value.renamePresets.length) return invalidBackup();
  const rawVolume = previewPreferences.volume;
  const audioVolume = previewPreferences.audioVolume;
  const storedSettings = normalizeLegacySettings(value.settings as Partial<Settings>, settingsVersion);
  const { ffmpegPath: _toolPath, ...settings } = coerceSettings({
    ...storedSettings,
    // Older backups saved their remembered view with the lower pane preferences.
    lastUsedViewMode: storedSettings.lastUsedViewMode === undefined
      ? coerceRememberedViewMode(panePreferences.defaultViewMode)
      : storedSettings.lastUsedViewMode,
  });
  return {
    settings,
    settingsVersion: SETTINGS_STORAGE_VERSION,
    renamePresets,
    current: importSession(value.current),
    previous: value.previous == null ? null : importSession(value.previous),
    unnamedRecentMoves: pathList(value.unnamedRecentMoves),
    unnamedQuickMove: importQuickMove(value.unnamedQuickMove),
    panePreferences: {
      showBreadcrumbs: panePreferences.showBreadcrumbs === true,
    },
    previewPreferences: {
      volume: typeof rawVolume === "number" && Number.isFinite(rawVolume) ? clampVolume(rawVolume) : DEFAULT_PREVIEW_VOLUME,
      audioVolume: typeof audioVolume === "number" && Number.isFinite(audioVolume) ? clampVolume(audioVolume) : undefined,
      stripOpen: previewPreferences.stripOpen !== false,
    },
  };
};

export const readStratumBackup = (data: string): StratumBackup => {
  let value: unknown;
  try {
    value = JSON.parse(data.replace(/^\uFEFF/, ""));
  } catch {
    return invalidBackup();
  }
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) return invalidBackup();
  if (value.version !== BACKUP_VERSION) throw new Error("This Stratum backup uses an unsupported format version.");
  if (!Array.isArray(value.workspaces) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    return invalidBackup();
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  const workspaces = value.workspaces.map((entry): BackupWorkspace => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim() || typeof entry.name !== "string") {
      return invalidBackup();
    }
    const name = entry.name.trim();
    const nameKey = name.toLowerCase();
    if (!name || ids.has(entry.id) || names.has(nameKey)) return invalidBackup();
    ids.add(entry.id);
    names.add(nameKey);
    return {
      id: entry.id,
      name,
      layout: importLayout(entry.layout),
      draft: entry.draft === undefined ? undefined : importLayout(entry.draft),
      recentMoves: pathList(entry.recentMoves),
      quickMove: importQuickMove(entry.quickMove),
    };
  });
  const header = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: value.createdAt, workspaces,
    remoteHosts: importRemoteHosts(value.remoteHosts) } as const;
  if (value.scope === "full") return { ...header, scope: "full", profile: importProfile(value.profile, ids) };
  if (value.scope === "workspaces" && workspaces.length) return { ...header, scope: "workspaces" };
  return invalidBackup();
};
