// Keep the picker state outside saved layouts, like the workspace's recent destinations.
import { create } from "zustand";
import { folderPathKey } from "@/lib/paths";
import {
  coerceQuickMovePreferences,
  DEFAULT_QUICK_MOVE_PREFERENCES,
  isDefaultQuickMovePreferences,
} from "./quickMovePreferences";
import type { QuickMovePreferences } from "./quickMovePreferences";
import { useWorkspaceStore } from "./workspaceStore";

export type { QuickMovePreferences } from "./quickMovePreferences";

type WorkspaceId = string | null;
type PickerPreferences = Map<WorkspaceId, QuickMovePreferences>;
type PickerFilterPatch = Partial<Pick<QuickMovePreferences, "driveRoots" | "maxDepth">>;

const STORAGE_KEY = "stratum.quick-move";

const validWorkspaceIds = () => new Set<WorkspaceId>([
  null, ...useWorkspaceStore.getState().workspaces.map(({ id }) => id),
]);

const readPreferences = (): PickerPreferences => {
  const preferences: PickerPreferences = new Map();
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return preferences;
    const validIds = validWorkspaceIds();
    for (const entry of stored) {
      if (!Array.isArray(entry) || !validIds.has(entry[0])) continue;
      const picker = coerceQuickMovePreferences(entry[1]);
      if (!isDefaultQuickMovePreferences(picker)) preferences.set(entry[0], picker);
    }
  } catch {
    // The picker remains usable with default preferences if storage is unavailable.
  }
  return preferences;
};

const useQuickMoveStore = create<{ preferences: PickerPreferences }>(() => ({ preferences: readPreferences() }));

export const getQuickMoveWorkspacePreferences = (): ReadonlyMap<WorkspaceId, QuickMovePreferences> =>
  useQuickMoveStore.getState().preferences;

export const getQuickMovePreferences = (workspaceId: WorkspaceId) =>
  getQuickMoveWorkspacePreferences().get(workspaceId) ?? DEFAULT_QUICK_MOVE_PREFERENCES;

export const useQuickMovePreferences = (workspaceId: WorkspaceId) =>
  useQuickMoveStore((state) => state.preferences.get(workspaceId) ?? DEFAULT_QUICK_MOVE_PREFERENCES);

export const serializeQuickMovePreferences = (preferences: PickerPreferences) =>
  [STORAGE_KEY, JSON.stringify([...preferences])] as const;

export const publishQuickMovePreferences = (preferences: PickerPreferences) =>
  useQuickMoveStore.setState({ preferences });

export const putQuickMoveWorkspacePreferences = (
  preferences: PickerPreferences,
  workspaceId: WorkspaceId,
  picker: QuickMovePreferences,
) => {
  if (isDefaultQuickMovePreferences(picker)) preferences.delete(workspaceId);
  else preferences.set(workspaceId, picker);
};

const savePreferences = (preferences: PickerPreferences) => {
  publishQuickMovePreferences(preferences);
  try {
    globalThis.localStorage?.setItem(...serializeQuickMovePreferences(preferences));
  } catch {
    // Keep picker changes available in the current window if storage is unavailable.
  }
};

const updatePreferences = (workspaceId: WorkspaceId, picker: QuickMovePreferences) => {
  if (workspaceId !== null && !useWorkspaceStore.getState().workspaces.some(({ id }) => id === workspaceId)) return;
  const preferences = new Map(getQuickMoveWorkspacePreferences());
  putQuickMoveWorkspacePreferences(preferences, workspaceId, coerceQuickMovePreferences(picker));
  savePreferences(preferences);
};

export const updateQuickMovePreferences = (workspaceId: WorkspaceId, patch: PickerFilterPatch) => {
  const current = getQuickMovePreferences(workspaceId);
  updatePreferences(workspaceId, {
    ...current,
    driveRoots: patch.driveRoots === undefined ? current.driveRoots : patch.driveRoots,
    maxDepth: patch.maxDepth === undefined ? current.maxDepth : patch.maxDepth,
  });
};

export const toggleQuickMoveFavorite = (workspaceId: WorkspaceId, path: string) => {
  const key = folderPathKey(path);
  if (!key || path.includes("\0")) return;
  const current = getQuickMovePreferences(workspaceId);
  const existing = current.favorites.filter((item) => folderPathKey(item) !== key);
  const favorites = existing.length === current.favorites.length ? [...existing, path] : existing;
  updatePreferences(workspaceId, { ...current, favorites });
};

// A removed workspace no longer owns favourites or filters, even when it was active.
useWorkspaceStore.subscribe(({ workspaces }, previous) => {
  if (workspaces.length >= previous.workspaces.length) return;
  const validIds = validWorkspaceIds();
  const preferences = getQuickMoveWorkspacePreferences();
  const remaining = new Map([...preferences].filter(([workspaceId]) => validIds.has(workspaceId)));
  if (remaining.size !== preferences.size) savePreferences(remaining);
});
