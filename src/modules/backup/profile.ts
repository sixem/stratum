// Capture and apply the portable profile using the same stores as regular workspace changes.
import { SETTINGS_STORAGE_VERSION, PREVIEW_STRIP_OPEN_KEY, PREVIEW_VOLUME_KEY, AUDIO_PREVIEW_VOLUME_KEY } from "@/constants/settings";
import { DEFAULT_PREVIEW_VOLUME, readPreviewVolume } from "@/lib/previewVolume";
import { captureWorkspaceLayout } from "@/lib/captureWorkspaceLayout";
import { folderPathKey } from "@/lib/paths";
import { serializeBatchRenamePresets, useBatchRenamePresetStore } from "../batchRenamePresetStore";
import type { BatchRenamePreset } from "../batchRenamePresetStore";
import { DEFAULT_BOTTOM_PANE_LAYOUT, serializeBottomPane, useBottomPaneStore } from "../bottomPaneStore";
import { serializePlaces } from "../placesStore";
import {
  getQuickMovePreferences,
  getQuickMoveWorkspacePreferences,
  publishQuickMovePreferences,
  putQuickMoveWorkspacePreferences,
  serializeQuickMovePreferences,
} from "../quickMoveStore";
import { getRecentMoveHistory, publishRecentMoveHistory, serializeRecentMoveHistory } from "../recentMoveStore";
import { getPaneSessionStore, serializePaneSession } from "../sessionStore";
import { DEFAULT_SETTINGS } from "../settings.defaults";
import { coerceSettings } from "../settings.normalize";
import { serializeSettings, useSettingsStore } from "../settings.store";
import { fillTabGridSizes, getDefaultTabGridSize, getTabGridSizeOnEnable } from "../tabGridSize";
import { applyWorkspaceRestore, fillWorkspaceStateGridSizes, getWorkspaceChanges, hasCustomWorkspacePlaces, parkPreviousWorkspace, prepareWorkspaceRestore, serializeWorkspaceState, useWorkspaceStore } from "../workspaceStore";
import type { Workspace, WorkspaceSession } from "../workspaceStore";
import { makeImportedName, planBackupWorkspaceNames } from "./mergeWorkspaces";
import type { BackupConflictPolicy } from "./mergeWorkspaces";
import { writeBackupRecords } from "./persistence";
import type { BackupStorageRecord } from "./persistence";
import { BACKUP_FORMAT, BACKUP_VERSION } from "./types";
import type { StratumBackup } from "./types";

export type BackupImportOptions = {
  conflicts: BackupConflictPolicy;
  restorePreferences: boolean;
  openSession: boolean;
};

const readPreviewPreferences = () => {
  try {
    return {
      volume: readPreviewVolume(PREVIEW_VOLUME_KEY),
      audioVolume: readPreviewVolume(AUDIO_PREVIEW_VOLUME_KEY),
      stripOpen: globalThis.localStorage.getItem(PREVIEW_STRIP_OPEN_KEY) !== "false",
    };
  } catch {
    return { volume: DEFAULT_PREVIEW_VOLUME, audioVolume: DEFAULT_PREVIEW_VOLUME, stripOpen: true };
  }
};

export const captureStratumBackup = (scope: StratumBackup["scope"], selected: ReadonlySet<string>): StratumBackup => {
  const state = useWorkspaceStore.getState();
  const live = captureWorkspaceLayout();
  const drafts = new Map(getWorkspaceChanges(live).map(({ id, layout }) => [id, layout]));
  const recent = getRecentMoveHistory();
  const workspaces = state.workspaces.filter(({ id }) => scope === "full" || selected.has(id))
    .map((workspace) => ({
      ...workspace,
      draft: drafts.get(workspace.id),
      recentMoves: recent.get(workspace.id) ?? [],
      quickMove: getQuickMovePreferences(workspace.id),
    }));
  const header = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), workspaces } as const;
  if (scope === "workspaces") {
    if (!workspaces.length) throw new Error("Select a workspace to export.");
    return { ...header, scope };
  }
  const { showBreadcrumbs } = useBottomPaneStore.getState();
  const previous = state.previous;
  const { ffmpegPath: _toolPath, ...settings } = coerceSettings(useSettingsStore.getState());
  return {
    ...header,
    scope,
    profile: {
      settings,
      settingsVersion: SETTINGS_STORAGE_VERSION,
      renamePresets: useBatchRenamePresetStore.getState().presets,
      current: { id: state.activeId, layout: live },
      previous: previous && {
        ...previous,
        id: state.workspaces.some(({ id }) => id === previous.id) ? previous.id : null,
      },
      unnamedRecentMoves: recent.get(null) ?? [],
      unnamedQuickMove: getQuickMovePreferences(null),
      panePreferences: { showBreadcrumbs },
      previewPreferences: readPreviewPreferences(),
    },
  };
};

export const isUnusedBackupProfile = () => {
  const live = captureWorkspaceLayout();
  const { workspaces, previous } = useWorkspaceStore.getState();
  const { showBreadcrumbs } = useBottomPaneStore.getState();
  const { volume, audioVolume, stripOpen } = readPreviewPreferences();
  return !workspaces.length && !previous && !useBatchRenamePresetStore.getState().presets.length
    && !getRecentMoveHistory().size && !getQuickMoveWorkspacePreferences().size
    && ![...live.main.tabs, ...live.bottom.tabs].some(tab => tab.path || tab.terminal)
    && !live.main.recentJumps.length && !live.bottom.recentJumps.length && !hasCustomWorkspacePlaces(live.places)
    && !live.pane.open && live.pane.height === DEFAULT_BOTTOM_PANE_LAYOUT.height
    && !showBreadcrumbs && volume === DEFAULT_PREVIEW_VOLUME && audioVolume === DEFAULT_PREVIEW_VOLUME && stripOpen
    && JSON.stringify(coerceSettings(useSettingsStore.getState())) === JSON.stringify(coerceSettings(DEFAULT_SETTINGS));
};

const mergeRenamePresets = (incoming: BatchRenamePreset[]) => {
  const existing = useBatchRenamePresetStore.getState().presets;
  const names = new Map(existing.map((preset) => [preset.name.toLowerCase(), preset]));
  const taken = new Set([...names.keys(), ...incoming.map(({ name }) => name.toLowerCase())]);
  return [...existing, ...incoming.flatMap((preset) => {
    const collision = names.get(preset.name.toLowerCase());
    if (collision && collision.preserveExtensions === preset.preserveExtensions &&
      JSON.stringify(collision.rule) === JSON.stringify(preset.rule)) return [];
    return [{
      ...preset,
      id: globalThis.crypto.randomUUID(),
      name: collision ? makeImportedName(preset.name, taken) : preset.name,
    }];
  })];
};

const keepRecentMoves = (paths: readonly string[], limit: number) => {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = folderPathKey(path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
};

export const applyStratumBackup = (backup: StratumBackup, options: BackupImportOptions) => {
  const state = useWorkspaceStore.getState();
  const live = captureWorkspaceLayout();
  const profile = backup.scope === "full" ? backup.profile : undefined;
  const preferences = options.restorePreferences ? profile : undefined;
  const currentSettings = useSettingsStore.getState();
  // Availability checks run the configured tool. Its executable is chosen on this PC.
  const settings = preferences && { ...preferences.settings, ffmpegPath: currentSettings.ffmpegPath };
  const gridSizeOnEnable = settings ? getTabGridSizeOnEnable(settings, currentSettings) : undefined;
  const limit = settings?.recentMoveLimit ?? currentSettings.recentMoveLimit;
  const presets = preferences && mergeRenamePresets(preferences.renamePresets);
  const recent = new Map(getRecentMoveHistory());
  const quickMove = new Map(getQuickMoveWorkspacePreferences());
  const drafts = new Map(getWorkspaceChanges(live).map(({ id, layout }) => [id, layout]));
  const importedIds = new Map<string, string>();
  const replacements = new Map<string, Workspace>();
  const additions: Workspace[] = [];

  for (const { workspace, name, replacingId } of planBackupWorkspaceNames(backup.workspaces, state.workspaces, options.conflicts)) {
    const id = replacingId ?? globalThis.crypto.randomUUID();
    const next = { id, name, layout: workspace.layout };
    importedIds.set(workspace.id, id);
    if (replacingId) replacements.set(id, next);
    else additions.push(next);
    if (workspace.draft) drafts.set(id, workspace.draft);
    else drafts.delete(id);
    const destinations = keepRecentMoves(workspace.recentMoves, limit);
    if (destinations.length) recent.set(id, destinations);
    else recent.delete(id);
    // Backups made before Quick Move carry no instructions for the matching workspace's picker.
    if (workspace.quickMove) putQuickMoveWorkspacePreferences(quickMove, id, workspace.quickMove);
  }

  const resolveSession = (session: WorkspaceSession): WorkspaceSession => ({
    ...session,
    id: session.id ? importedIds.get(session.id) ?? null : null,
  });
  // Imported workspaces receive new IDs unless they replace a named snapshot.
  if (settings?.startupWorkspaceId) {
    settings.startupWorkspaceId = importedIds.get(settings.startupWorkspaceId) ?? null;
  }
  const restored = profile && options.openSession ? resolveSession(profile.current) : null;
  const defaultGridSize = getDefaultTabGridSize(settings ?? currentSettings);
  const prepared = restored ? prepareWorkspaceRestore(restored.layout, defaultGridSize) : null;
  // Keep the live layout available if an explicit replacement takes its saved name.
  const outgoingId = state.activeId && replacements.has(state.activeId) ? null : state.activeId;
  const previous = restored
    ? isUnusedBackupProfile() ? (profile?.previous ? resolveSession(profile.previous) : null) : { id: outgoingId, layout: live }
    : state.previous && { ...state.previous, id: state.previous.id && replacements.has(state.previous.id) ? null : state.previous.id };
  const next = fillWorkspaceStateGridSizes({
    workspaces: [...state.workspaces.map((item) => replacements.get(item.id) ?? item), ...additions],
    activeId: restored ? restored.id : outgoingId,
    previous,
    drafts: [...drafts].map(([id, layout]) => ({ id, layout })),
  }, defaultGridSize);

  if (restored && profile?.unnamedRecentMoves.length) {
    recent.set(null, keepRecentMoves([...profile.unnamedRecentMoves, ...(recent.get(null) ?? [])], limit));
  }
  if (restored && profile?.unnamedQuickMove) {
    putQuickMoveWorkspacePreferences(quickMove, null, profile.unnamedQuickMove);
  }
  for (const [id, paths] of recent) {
    if (paths.length > limit) recent.set(id, paths.slice(0, limit));
  }
  const records: BackupStorageRecord[] = [
    serializeWorkspaceState(next), serializeRecentMoveHistory(recent), serializeQuickMovePreferences(quickMove),
  ];
  if (prepared) {
    records.push(serializePaneSession("main", prepared.main), serializePaneSession("bottom", prepared.bottom), serializePlaces(prepared.places));
  } else if (gridSizeOnEnable !== undefined) {
    // Enabling per-tab sizes also persists the currently open tabs.
    for (const pane of ["main", "bottom"] as const) {
      const session = getPaneSessionStore(pane).getState();
      records.push(serializePaneSession(pane, { ...session, tabs: fillTabGridSizes(session.tabs, gridSizeOnEnable) }));
    }
  }
  if (prepared || preferences) {
    records.push(serializeBottomPane({ ...useBottomPaneStore.getState(), ...prepared?.pane, ...preferences?.panePreferences }));
  }
  if (preferences && settings && presets) {
    records.push(
      serializeSettings(settings), serializeBatchRenamePresets(presets),
      [PREVIEW_VOLUME_KEY, String(preferences.previewPreferences.volume)],
      [PREVIEW_STRIP_OPEN_KEY, String(preferences.previewPreferences.stripOpen)],
    );
    if (preferences.previewPreferences.audioVolume !== undefined) {
      records.push([AUDIO_PREVIEW_VOLUME_KEY, String(preferences.previewPreferences.audioVolume)]);
    }
  }
  writeBackupRecords(records);

  if (restored && previous?.layout === live) parkPreviousWorkspace(next);
  useWorkspaceStore.setState(next);
  publishRecentMoveHistory(recent);
  publishQuickMovePreferences(quickMove);
  if (preferences && settings && presets) {
    useSettingsStore.getState().setSettings(settings);
    useBatchRenamePresetStore.setState({ presets });
  }
  if (prepared) applyWorkspaceRestore(prepared, preferences?.panePreferences);
  else if (preferences) useBottomPaneStore.setState(preferences.panePreferences);
};
