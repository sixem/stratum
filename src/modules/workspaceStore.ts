// Named workspaces are explicit snapshots of both pane layouts.
import { createWithEqualityFn } from "zustand/traditional";
import { clampPaneHeight, useBottomPaneStore } from "./bottomPaneStore";
import { coerceTabLayout, useBottomSessionStore, useSessionStore } from "./sessionStore";
import type { TabLayout } from "./sessionStore";

type PaneLayout = Pick<ReturnType<typeof useBottomPaneStore.getState>, "open" | "height" | "defaultViewMode" | "active">;

export type WorkspaceLayout = {
  main: TabLayout;
  bottom: TabLayout;
  pane: PaneLayout;
};

export type Workspace = {
  id: string;
  name: string;
  layout: WorkspaceLayout;
};

type WorkspaceSession = { id: string | null; layout: WorkspaceLayout };
type SavedWorkspaces = { workspaces: Workspace[]; activeId: string | null };
type WorkspaceState = SavedWorkspaces & { previous: WorkspaceSession | null };

const STORAGE_KEY = "stratum.workspaces";
const STORAGE_VERSION = 1;
const EMPTY: SavedWorkspaces = { workspaces: [], activeId: null };

const readLayout = (value: Partial<WorkspaceLayout> | undefined): WorkspaceLayout | null => {
  if (!value || !Array.isArray(value.main?.tabs) || !Array.isArray(value.bottom?.tabs)) return null;
  const pane = value.pane;
  const open = pane?.open === true;
  return {
    main: coerceTabLayout(value.main),
    bottom: coerceTabLayout(value.bottom),
    pane: {
      open,
      height: typeof pane?.height === "number" && Number.isFinite(pane.height) ? clampPaneHeight(pane.height) : 35,
      defaultViewMode: pane?.defaultViewMode === "thumbs" ? "thumbs" : "list",
      active: open && pane?.active === true,
    },
  };
};

const readWorkspaces = (): SavedWorkspaces => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const payload = JSON.parse(raw) as Partial<SavedWorkspaces> & { version?: number };
    if (payload?.version !== STORAGE_VERSION || !Array.isArray(payload.workspaces)) return EMPTY;
    const ids = new Set<string>();
    const names = new Set<string>();
    const workspaces: Workspace[] = [];
    for (const entry of payload.workspaces) {
      if (typeof entry?.id !== "string" || !entry.id || typeof entry.name !== "string") continue;
      const name = entry.name.trim();
      const key = name.toLowerCase();
      if (!key || ids.has(entry.id) || names.has(key)) continue;
      const layout = readLayout(entry.layout);
      if (!layout) continue;
      workspaces.push({ id: entry.id, name, layout });
      ids.add(entry.id);
      names.add(key);
    }
    const activeId = payload.activeId && ids.has(payload.activeId) ? payload.activeId : null;
    return { workspaces, activeId };
  } catch {
    return EMPTY;
  }
};

export const useWorkspaceStore = createWithEqualityFn<WorkspaceState>(() => ({
  ...readWorkspaces(),
  previous: null,
}));

const persist = (next: SavedWorkspaces) => {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...next }));
  } catch {
    throw new Error("Couldn't save workspaces to local storage.");
  }
  useWorkspaceStore.setState(next);
};

export const saveWorkspace = (name: string, layout: WorkspaceLayout, existingId?: string, activate = true) => {
  const { workspaces, activeId } = useWorkspaceStore.getState();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a workspace name.");
  if (existingId && !workspaces.some(({ id }) => id === existingId)) {
    throw new Error("This workspace no longer exists.");
  }
  if (workspaces.some((item) => item.id !== existingId && item.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("A workspace with this name already exists.");
  }
  const workspace = { id: existingId ?? globalThis.crypto.randomUUID(), name: trimmed, layout };
  persist({
    workspaces: existingId ? workspaces.map((item) => item.id === existingId ? workspace : item) : [...workspaces, workspace],
    activeId: activate ? workspace.id : activeId,
  });
};

export const removeWorkspace = (id: string) => {
  const { workspaces, activeId } = useWorkspaceStore.getState();
  persist({ workspaces: workspaces.filter((item) => item.id !== id), activeId: activeId === id ? null : activeId });
};

export const switchWorkspace = (target: WorkspaceSession, outgoing: WorkspaceLayout) => {
  const { workspaces, activeId } = useWorkspaceStore.getState();
  // The previous session remains switchable if its named snapshot was deleted.
  const id = workspaces.some((item) => item.id === target.id) ? target.id : null;
  persist({ workspaces, activeId: id });
  useWorkspaceStore.setState({ previous: { id: activeId, layout: outgoing } });
  useSessionStore.getState().restoreTabs(target.layout.main);
  useBottomSessionStore.getState().restoreTabs(target.layout.bottom);
  useBottomPaneStore.setState({ ...target.layout.pane, navigation: null });
};
