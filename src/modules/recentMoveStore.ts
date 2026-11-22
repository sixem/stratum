// Move destinations belong to the workspace that started the job. Keep them
// separate from its editable layout so ordinary transfers do not create drafts.
import { create } from "zustand";
import { folderPathKey } from "@/lib/paths";
import { useSettingsStore } from "./settings.store";
import { useWorkspaceStore } from "./workspaceStore";

type WorkspaceId = string | null;
type MoveHistory = Map<WorkspaceId, readonly string[]>;

const STORAGE_KEY = "stratum.recent-moves";
const EMPTY: readonly string[] = [];

const validWorkspaceIds = () => new Set<WorkspaceId>([
  null, ...useWorkspaceStore.getState().workspaces.map(({ id }) => id),
]);

const readMoveHistory = (): MoveHistory => {
  const history: MoveHistory = new Map();
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return history;
    const limit = useSettingsStore.getState().recentMoveLimit;
    const validIds = validWorkspaceIds();
    for (const entry of stored) {
      if (!Array.isArray(entry) || !validIds.has(entry[0]) || !Array.isArray(entry[1])) continue;
      const seen = new Set<string>();
      const paths: string[] = [];
      for (const path of entry[1]) {
        if (typeof path !== "string") continue;
        const key = folderPathKey(path);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        paths.push(path);
        if (paths.length >= limit) break;
      }
      if (paths.length) history.set(entry[0], paths);
    }
  } catch {
    // Use an in-memory history when local storage is unavailable.
  }
  return history;
};

const useRecentMoveStore = create<{ history: MoveHistory }>(() => ({ history: readMoveHistory() }));

const saveHistory = (history: MoveHistory) => {
  useRecentMoveStore.setState({ history });
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...history]));
  } catch {
    // A storage failure should never change the outcome of a filesystem job.
  }
};

export const captureMoveHistoryWorkspace = (): WorkspaceId | undefined =>
  useSettingsStore.getState().rememberMoveDestinations ? useWorkspaceStore.getState().activeId : undefined;

export const recordMoveDestination = (workspaceId: WorkspaceId | undefined, path: string) => {
  const { rememberMoveDestinations, recentMoveLimit } = useSettingsStore.getState();
  if (workspaceId === undefined || !rememberMoveDestinations) return;
  if (workspaceId !== null && !useWorkspaceStore.getState().workspaces.some(({ id }) => id === workspaceId)) return;
  const history = useRecentMoveStore.getState().history;
  const previous = history.get(workspaceId) ?? EMPTY;
  if (previous[0] === path) return;

  const key = folderPathKey(path);
  const destinations = [path, ...previous.filter((item) => folderPathKey(item) !== key)].slice(0, recentMoveLimit);
  saveHistory(new Map(history).set(workspaceId, destinations));
};

export const clearMoveDestinations = (workspaceId: WorkspaceId) => {
  const previous = useRecentMoveStore.getState().history;
  if (!previous.has(workspaceId)) return;
  const history = new Map(previous);
  history.delete(workspaceId);
  saveHistory(history);
};

export const useRecentMoveDestinations = () => {
  const workspaceId = useWorkspaceStore((state) => state.activeId);
  const enabled = useSettingsStore((state) => state.rememberMoveDestinations);
  const destinations = useRecentMoveStore((state) => enabled ? state.history.get(workspaceId) ?? EMPTY : EMPTY);
  return { workspaceId, destinations };
};

// Evict old entries immediately when the limit drops, even in inactive workspaces.
useSettingsStore.subscribe(({ recentMoveLimit }, previous) => {
  if (recentMoveLimit >= previous.recentMoveLimit) return;
  const history = new Map(useRecentMoveStore.getState().history);
  let changed = false;
  for (const [workspaceId, paths] of history) {
    if (paths.length <= recentMoveLimit) continue;
    history.set(workspaceId, paths.slice(0, recentMoveLimit));
    changed = true;
  }
  if (changed) saveHistory(history);
});

// Deleting a named workspace also removes its recent destinations.
useWorkspaceStore.subscribe(({ workspaces }, previous) => {
  if (workspaces.length >= previous.workspaces.length) return;
  const validIds = validWorkspaceIds();
  const history = useRecentMoveStore.getState().history;
  const remaining = new Map([...history].filter(([workspaceId]) => validIds.has(workspaceId)));
  if (remaining.size !== history.size) saveHistory(remaining);
});
