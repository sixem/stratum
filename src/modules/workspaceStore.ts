// Named workspaces are explicit snapshots. Keep a draft when leaving a changed workspace.
import { createWithEqualityFn } from "zustand/traditional";
import { folderPathKey } from "@/lib/paths";
import type { Place } from "@/types";
import { coerceBottomPaneHeight, DEFAULT_BOTTOM_PANE_LAYOUT, useBottomPaneStore } from "./bottomPaneStore";
import type { BottomPaneLayout } from "./bottomPaneStore";
import { coercePlacesState, DEFAULT_PLACES_STATE, usePlacesStore } from "./placesStore";
import type { PlacesState } from "./placesStore";
import { coerceSession, createSessionTab, useBottomSessionStore, useSessionStore } from "./sessionStore";
import type { SessionState } from "./sessionStore";
import { useSettingsStore } from "./settings.store";
import type { FixedGridSize } from "./settings.types";
import { fillTabGridSizes, getDefaultTabGridSize, getTabGridSizeOnEnable } from "./tabGridSize";

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
type WorkspaceDraft = Pick<Workspace, "id" | "layout">;
type WorkspaceState = {
  workspaces: Workspace[];
  activeId: string | null;
  previous: WorkspaceSession | null;
  drafts: WorkspaceDraft[];
};

const STORAGE_KEY = "stratum.workspaces";
const STORAGE_VERSION = 1;
const EMPTY: WorkspaceState = { workspaces: [], activeId: null, previous: null, drafts: [] };

let defaultPlaces = DEFAULT_PLACES_STATE;

export const setWorkspaceDefaultPlaces = (places: Place[]) => {
  defaultPlaces = coercePlacesState({ initialized: true, places });
};

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
      ...coerceBottomPaneHeight(pane),
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
    // The old format kept only the previous session. Recover it as a potential draft.
    const storedDrafts = Array.isArray(payload.drafts) ? payload.drafts : previous ? [previous] : [];
    const drafts: WorkspaceDraft[] = [];
    for (const entry of storedDrafts) {
      if (!entry?.id || !ids.has(entry.id)) continue;
      const layout = readLayout(entry.layout);
      if (layout) drafts.push({ id: entry.id, layout });
    }
    return { workspaces, activeId, previous, drafts };
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

// Saved layouts must keep their baseline even when the preset changes while they are inactive.
const fillWorkspaceGridSizes = (gridSize: FixedGridSize | undefined) => {
  if (!gridSize) return;
  const state = useWorkspaceStore.getState();
  const fillLayout = <T extends { layout: WorkspaceLayout }>(entry: T): T => {
    const { layout } = entry;
    const main = fillTabGridSizes(layout.main.tabs, gridSize);
    const bottom = fillTabGridSizes(layout.bottom.tabs, gridSize);
    if (main === layout.main.tabs && bottom === layout.bottom.tabs) return entry;
    return { ...entry, layout: { ...layout, main: { ...layout.main, tabs: main }, bottom: { ...layout.bottom, tabs: bottom } } };
  };
  const workspaces = state.workspaces.map(fillLayout);
  const drafts = state.drafts.map(fillLayout);
  const previousLayout = state.previous && fillLayout(state.previous);
  if (previousLayout === state.previous && workspaces.every((item, index) => item === state.workspaces[index]) &&
      drafts.every((item, index) => item === state.drafts[index])) return;

  const updated = { ...state, workspaces, drafts, previous: previousLayout };
  try {
    persist(updated);
  } catch {
    // Keep the live layout consistent if local storage is unavailable.
    useWorkspaceStore.setState(updated);
  }
};
fillWorkspaceGridSizes(getDefaultTabGridSize(useSettingsStore.getState()));
useSettingsStore.subscribe((next, previous) => fillWorkspaceGridSizes(getTabGridSizeOnEnable(next, previous)));

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

const sameTabs = (saved: SessionState, current: SessionState) =>
  saved.tabs.length === current.tabs.length && saved.tabs.every((tab, index) => {
    const other = current.tabs[index];
    const samePath = tab.path === other.path || folderPathKey(tab.path) === folderPathKey(other.path);
    return samePath && tab.viewMode === other.viewMode && tab.gridSize === other.gridSize && tab.search === other.search &&
      tab.sort.key === other.sort.key && tab.sort.dir === other.sort.dir;
  });

// Focus, scroll, recent jumps, and regenerated tab IDs are saved when available,
// but ordinary browsing state on its own should never trigger the exit warning.
const hasLayoutChanges = (saved: WorkspaceLayout, current: WorkspaceLayout) => {
  if (!sameTabs(saved.main, current.main) || !sameTabs(saved.bottom, current.bottom)) return true;
  if (saved.pane.open !== current.pane.open) return true;
  // Old percentage-based heights can be converted automatically on display.
  if (saved.pane.heightUnit === current.pane.heightUnit && saved.pane.height !== current.pane.height) return true;
  const savedPlaces = (saved.places.initialized ? saved.places : defaultPlaces).places;
  const currentPlaces = (current.places.initialized ? current.places : defaultPlaces).places;
  return savedPlaces.length !== currentPlaces.length || savedPlaces.some((place, index) => {
    const other = currentPlaces[index];
    return place.path !== other.path || place.name !== other.name || Boolean(place.pinned) !== Boolean(other.pinned);
  });
};

const collectDrafts = ({ workspaces, activeId, drafts }: WorkspaceState, live: WorkspaceLayout) => {
  const layouts = new Map(drafts.map(({ id, layout }) => [id, layout]));
  if (activeId) layouts.set(activeId, live);
  return workspaces.flatMap((workspace) => {
    const layout = layouts.get(workspace.id);
    return layout && hasLayoutChanges(workspace.layout, layout) ? [{ ...workspace, layout }] : [];
  });
};

export const getWorkspaceChanges = (live: WorkspaceLayout) => collectDrafts(useWorkspaceStore.getState(), live);

export const saveWorkspaceChanges = (changes: WorkspaceDraft[]) => {
  if (!changes.length) return;
  const state = useWorkspaceStore.getState();
  const layouts = new Map(changes.map(({ id, layout }) => [id, layout]));
  // Save all checked layouts together so a storage failure cannot leave a partial save.
  persist({
    ...state,
    workspaces: state.workspaces.map((workspace) => {
      const layout = layouts.get(workspace.id);
      return layout ? { ...workspace, layout } : workspace;
    }),
    drafts: state.drafts.filter(({ id }) => !layouts.has(id)),
  });
};

export const saveWorkspace = (name: string, layout: WorkspaceLayout, existingId?: string, activate = true) => {
  const state = useWorkspaceStore.getState();
  const { workspaces, activeId } = state;
  const workspace = defineWorkspace(workspaces, name, layout, existingId);
  // Saving the live layout under another name can leave edits to the old workspace pending.
  const drafts = activate
    ? collectDrafts(state, layout).filter(({ id }) => id !== workspace.id)
    : state.drafts;
  persist({
    ...state,
    workspaces: existingId ? workspaces.map((item) => item.id === existingId ? workspace : item) : [...workspaces, workspace],
    activeId: activate ? workspace.id : activeId,
    drafts,
  });
};

export const removeWorkspace = (id: string) => {
  const state = useWorkspaceStore.getState();
  persist({
    ...state,
    workspaces: state.workspaces.filter((item) => item.id !== id),
    activeId: state.activeId === id ? null : state.activeId,
    drafts: state.drafts.filter((draft) => draft.id !== id),
  });
};

const restoreLayout = (layout: WorkspaceLayout) => {
  useSessionStore.getState().restoreSession(layout.main);
  useBottomSessionStore.getState().restoreSession(layout.bottom);
  useBottomPaneStore.setState({ ...layout.pane, navigation: null });
  usePlacesStore.setState({ initialized: layout.places.initialized, places: [...layout.places.places] });
};

export const switchWorkspace = (target: WorkspaceSession, outgoing: WorkspaceLayout) => {
  const state = useWorkspaceStore.getState();
  // The previous session remains switchable if its named snapshot was deleted.
  const id = state.workspaces.some((item) => item.id === target.id) ? target.id : null;
  persist({ ...state, activeId: id, previous: { id: state.activeId, layout: outgoing }, drafts: collectDrafts(state, outgoing) });
  restoreLayout(target.layout);
};

export const createFreshWorkspace = (name: string, outgoing: WorkspaceLayout) => {
  const state = useWorkspaceStore.getState();
  const start = createSessionTab("", { viewMode: useSettingsStore.getState().defaultViewMode });
  const layout: WorkspaceLayout = {
    main: { tabs: [start], activeTabId: start.id, recentJumps: [] },
    bottom: { tabs: [], activeTabId: null, recentJumps: [] },
    pane: { ...DEFAULT_BOTTOM_PANE_LAYOUT },
    places: defaultPlaces,
  };
  const workspace = defineWorkspace(state.workspaces, name, layout);
  persist({
    workspaces: [...state.workspaces, workspace],
    activeId: workspace.id,
    previous: { id: state.activeId, layout: outgoing },
    drafts: collectDrafts(state, outgoing),
  });
  restoreLayout(layout);
};
