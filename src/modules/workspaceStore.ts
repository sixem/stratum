// Named workspaces are explicit snapshots of both pane layouts.
import { createWithEqualityFn } from "zustand/traditional";
import { createTab } from "@/lib/tabs";
import { clampPaneHeight, DEFAULT_BOTTOM_PANE_LAYOUT, useBottomPaneStore } from "./bottomPaneStore";
import type { BottomPaneLayout } from "./bottomPaneStore";
import { coercePlacesState, DEFAULT_PLACES_STATE, usePlacesStore } from "./placesStore";
import type { PlacesState } from "./placesStore";
import { coerceSession, useBottomSessionStore, useSessionStore } from "./sessionStore";
import type { SessionState } from "./sessionStore";
import { useSettingsStore } from "./settings.store";

export type WorkspaceLayout = {
  main: SessionState;
  bottom: SessionState;
  pane: BottomPaneLayout;
  places: PlacesState;
};

export type Workspace = {
  id: string;
  name: string;
  layout: WorkspaceLayout;
};

type WorkspaceSession = { id: string | null; layout: WorkspaceLayout };
type WorkspaceState = {
  workspaces: Workspace[];
  activeId: string | null;
  previous: WorkspaceSession | null;
};

const STORAGE_KEY = "stratum.workspaces";
const STORAGE_VERSION = 1;
const EMPTY: WorkspaceState = { workspaces: [], activeId: null, previous: null };

const readLayout = (value: Partial<WorkspaceLayout> | undefined): WorkspaceLayout | null => {
  if (!value || !Array.isArray(value.main?.tabs) || !Array.isArray(value.bottom?.tabs)) return null;
  const pane = value.pane;
  const open = pane?.open === true;
  // Older snapshots shared the live sidebar. Capture it before the first switch can replace it.
  return {
    main: coerceSession({ ...value.main, recentJumps: value.main.recentJumps ?? useSessionStore.getState().recentJumps }),
    bottom: coerceSession({ ...value.bottom, recentJumps: value.bottom.recentJumps ?? useBottomSessionStore.getState().recentJumps }),
    places: coercePlacesState(value.places ?? usePlacesStore.getState()),
    pane: {
      open,
      height: typeof pane?.height === "number" && Number.isFinite(pane.height)
        ? clampPaneHeight(pane.height) : DEFAULT_BOTTOM_PANE_LAYOUT.height,
      defaultViewMode: pane?.defaultViewMode === "thumbs" ? "thumbs" : "list",
      active: open && pane?.active === true,
    },
  };
};

const readWorkspaces = (): WorkspaceState => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const payload = JSON.parse(raw) as Partial<WorkspaceState> & { version?: number };
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
    const previousLayout = readLayout(payload.previous?.layout);
    const previousId = payload.previous?.id;
    const previous = previousLayout ? { id: previousId && ids.has(previousId) ? previousId : null, layout: previousLayout } : null;
    return { workspaces, activeId, previous };
  } catch {
    return EMPTY;
  }
};

export const useWorkspaceStore = createWithEqualityFn<WorkspaceState>(readWorkspaces);

const persist = (next: WorkspaceState) => {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...next }));
  } catch {
    throw new Error("Couldn't save workspaces to local storage.");
  }
  useWorkspaceStore.setState(next);
};

const defineWorkspace = (workspaces: Workspace[], name: string, layout: WorkspaceLayout, existingId?: string): Workspace => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a workspace name.");
  if (existingId && !workspaces.some(({ id }) => id === existingId)) {
    throw new Error("This workspace no longer exists.");
  }
  if (workspaces.some((item) => item.id !== existingId && item.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("A workspace with this name already exists.");
  }
  return { id: existingId ?? globalThis.crypto.randomUUID(), name: trimmed, layout };
};

export const saveWorkspace = (name: string, layout: WorkspaceLayout, existingId?: string, activate = true) => {
  const state = useWorkspaceStore.getState();
  const { workspaces, activeId } = state;
  const workspace = defineWorkspace(workspaces, name, layout, existingId);
  persist({
    ...state,
    workspaces: existingId ? workspaces.map((item) => item.id === existingId ? workspace : item) : [...workspaces, workspace],
    activeId: activate ? workspace.id : activeId,
  });
};

export const removeWorkspace = (id: string) => {
  const state = useWorkspaceStore.getState();
  persist({
    ...state,
    workspaces: state.workspaces.filter((item) => item.id !== id),
    activeId: state.activeId === id ? null : state.activeId,
  });
};

const restoreLayout = (layout: WorkspaceLayout) => {
  useSessionStore.getState().restoreSession(layout.main);
  useBottomSessionStore.getState().restoreSession(layout.bottom);
  useBottomPaneStore.setState({ ...layout.pane, navigation: null });
  usePlacesStore.setState({ initialized: layout.places.initialized, places: [...layout.places.places] });
};

export const switchWorkspace = (target: WorkspaceSession, outgoing: WorkspaceLayout) => {
  const { workspaces, activeId } = useWorkspaceStore.getState();
  // The previous session remains switchable if its named snapshot was deleted.
  const id = workspaces.some((item) => item.id === target.id) ? target.id : null;
  persist({ workspaces, activeId: id, previous: { id: activeId, layout: outgoing } });
  restoreLayout(target.layout);
};

export const createFreshWorkspace = (name: string, outgoing: WorkspaceLayout) => {
  const { workspaces, activeId } = useWorkspaceStore.getState();
  const start = createTab("", { viewMode: useSettingsStore.getState().defaultViewMode });
  const layout: WorkspaceLayout = {
    main: { tabs: [start], activeTabId: start.id, recentJumps: [] },
    bottom: { tabs: [], activeTabId: null, recentJumps: [] },
    pane: { ...DEFAULT_BOTTOM_PANE_LAYOUT },
    places: { ...DEFAULT_PLACES_STATE },
  };
  const workspace = defineWorkspace(workspaces, name, layout);
  persist({ workspaces: [...workspaces, workspace], activeId: workspace.id, previous: { id: activeId, layout: outgoing } });
  restoreLayout(layout);
};
