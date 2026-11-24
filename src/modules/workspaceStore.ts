// Named workspaces are explicit snapshots. Keep a draft when leaving a changed workspace.
import { createWithEqualityFn } from "zustand/traditional";
import { folderPathKey } from "@/lib/paths";
import { coercePaneLink } from "@/lib/paneLink";
import type { Place } from "@/types";
import { writeBackupRecords } from "./backup/persistence";
import type { BackupStorageRecord } from "./backup/persistence";
import { coerceBottomPaneHeight, DEFAULT_BOTTOM_PANE_LAYOUT, useBottomPaneStore } from "./bottomPaneStore";
import type { BottomPaneLayout, BottomPanePreferences } from "./bottomPaneStore";
import { coercePlacesState, DEFAULT_PLACES_STATE, usePlacesStore } from "./placesStore";
import type { PlacesState } from "./placesStore";
import { coerceSession, createSessionTab, prepareSessionRestore, serializePaneSession, useBottomSessionStore, useSessionStore } from "./sessionStore";
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

export type WorkspaceSession = { id: string | null; layout: WorkspaceLayout };
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
  const link = coercePaneLink(pane?.link);
  const main = coerceSession({ ...value.main, recentJumps: value.main.recentJumps ?? useSessionStore.getState().recentJumps });
  const bottom = coerceSession({ ...value.bottom, recentJumps: value.bottom.recentJumps ?? useBottomSessionStore.getState().recentJumps });
  // Older snapshots shared the live sidebar. Capture it before the first switch can replace it.
  return {
    main,
    bottom,
    places: coercePlacesState(value.places ?? usePlacesStore.getState()),
    pane: {
      open,
      ...coerceBottomPaneHeight(pane),
      active: open && pane?.active === true,
      link: link && main.tabs.some((tab) => tab.id === link.mainTabId)
        && bottom.tabs.some((tab) => tab.id === link.bottomTabId) ? link : null,
    },
  };
};

export { readLayout as readWorkspaceLayout };

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

export const serializeWorkspaceState = (next: WorkspaceState) =>
  [STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...next })] as const;

const persist = (next: WorkspaceState) => {
  try {
    globalThis.localStorage.setItem(...serializeWorkspaceState(next));
  } catch {
    throw new Error("Couldn't save workspaces to local storage.");
  }
  useWorkspaceStore.setState(next);
};

// Saved layouts must keep their baseline even when the preset changes while they are inactive.
export const fillWorkspaceStateGridSizes = (state: WorkspaceState, gridSize: FixedGridSize | undefined): WorkspaceState => {
  if (!gridSize) return state;
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
      drafts.every((item, index) => item === state.drafts[index])) return state;

  return { ...state, workspaces, drafts, previous: previousLayout };
};

const fillWorkspaceGridSizes = (gridSize: FixedGridSize | undefined) => {
  const state = useWorkspaceStore.getState();
  const updated = fillWorkspaceStateGridSizes(state, gridSize);
  if (updated === state) return;
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

const sameLink = (saved: WorkspaceLayout, current: WorkspaceLayout) => {
  const left = saved.pane.link;
  const right = current.pane.link;
  if (!left || !right) return !left && !right;
  return folderPathKey(left.mainRootPath) === folderPathKey(right.mainRootPath) &&
    folderPathKey(left.bottomRootPath) === folderPathKey(right.bottomRootPath) &&
    saved.main.tabs.findIndex(({ id }) => left.mainTabId === id) ===
      current.main.tabs.findIndex(({ id }) => right.mainTabId === id) &&
    saved.bottom.tabs.findIndex(({ id }) => left.bottomTabId === id) ===
      current.bottom.tabs.findIndex(({ id }) => right.bottomTabId === id);
};

const havePlacesChanged = (saved: PlacesState, current: PlacesState) => {
  const savedPlaces = (saved.initialized ? saved : defaultPlaces).places;
  const currentPlaces = (current.initialized ? current : defaultPlaces).places;
  return savedPlaces.length !== currentPlaces.length || savedPlaces.some((place, index) => {
    const other = currentPlaces[index];
    return place.path !== other.path || place.name !== other.name || Boolean(place.pinned) !== Boolean(other.pinned);
  });
};

export const hasCustomWorkspacePlaces = (places: PlacesState) => havePlacesChanged(defaultPlaces, places);

// Focus, scroll, recent jumps, and regenerated tab IDs are saved when available,
// but ordinary browsing state on its own should never trigger the exit warning.
const hasLayoutChanges = (saved: WorkspaceLayout, current: WorkspaceLayout) => {
  if (!sameTabs(saved.main, current.main) || !sameTabs(saved.bottom, current.bottom)) return true;
  if (!sameLink(saved, current)) return true;
  if (saved.pane.open !== current.pane.open) return true;
  // Old percentage-based heights can be converted automatically on display.
  if (saved.pane.heightUnit === current.pane.heightUnit && saved.pane.height !== current.pane.height) return true;
  return havePlacesChanged(saved.places, current.places);
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

export const clearRecentLocations = () => {
  const state = useWorkspaceStore.getState();
  const clearLayout = <T extends { layout: WorkspaceLayout }>(entry: T): T => {
    const { layout } = entry;
    if (!layout.main.recentJumps.length && !layout.bottom.recentJumps.length) return entry;
    return {
      ...entry,
      layout: {
        ...layout,
        main: { ...layout.main, recentJumps: [] },
        bottom: { ...layout.bottom, recentJumps: [] },
      },
    };
  };
  const workspaces = state.workspaces.map(clearLayout);
  const drafts = state.drafts.map(clearLayout);
  const previous = state.previous && clearLayout(state.previous);
  const changed = workspaces.some((item, index) => item !== state.workspaces[index]) ||
    drafts.some((item, index) => item !== state.drafts[index]) || previous !== state.previous;
  const next = { ...state, workspaces, drafts, previous };
  const main = useSessionStore.getState();
  const bottom = useBottomSessionStore.getState();
  const records: BackupStorageRecord[] = [];
  if (changed) records.push(serializeWorkspaceState(next));
  if (main.recentJumps.length) records.push(serializePaneSession("main", { ...main, recentJumps: [] }));
  if (bottom.recentJumps.length) records.push(serializePaneSession("bottom", { ...bottom, recentJumps: [] }));
  if (!records.length) return;

  // Persist both panes and the workspace snapshots together before publishing them.
  try {
    writeBackupRecords(records);
  } catch {
    throw new Error("Couldn't update the saved location history.");
  }
  if (changed) useWorkspaceStore.setState(next);
  if (main.recentJumps.length) main.setRecentJumps([]);
  if (bottom.recentJumps.length) bottom.setRecentJumps([]);
};

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

export const prepareWorkspaceRestore = (layout: WorkspaceLayout, gridSize: FixedGridSize | undefined): WorkspaceLayout => {
  const main = prepareSessionRestore(layout.main, gridSize);
  const bottom = prepareSessionRestore(layout.bottom, gridSize);
  const link = layout.pane.link;
  const mainIndex = link ? layout.main.tabs.findIndex(({ id }) => link.mainTabId === id) : -1;
  const bottomIndex = link ? layout.bottom.tabs.findIndex(({ id }) => link.bottomTabId === id) : -1;
  // Each restored tab has a new ID, so reconnect the pair by its saved position.
  const mainTabId = main.tabs[mainIndex]?.id;
  const bottomTabId = bottom.tabs[bottomIndex]?.id;
  return {
    ...layout, main, bottom,
    pane: { ...layout.pane, link: link && mainTabId && bottomTabId ? { ...link, mainTabId, bottomTabId } : null },
  };
};

export const applyWorkspaceRestore = (prepared: WorkspaceLayout, preferences?: BottomPanePreferences) => {
  useSessionStore.getState().restoreSession(prepared.main);
  useBottomSessionStore.getState().restoreSession(prepared.bottom);
  useBottomPaneStore.setState({
    ...prepared.pane, ...preferences, navigation: null,
  });
  usePlacesStore.setState({ initialized: prepared.places.initialized, places: [...prepared.places.places] });
};

const restoreLayout = (layout: WorkspaceLayout) =>
  applyWorkspaceRestore(prepareWorkspaceRestore(layout, getDefaultTabGridSize(useSettingsStore.getState())));

export const switchWorkspace = (target: WorkspaceSession, outgoing: WorkspaceLayout) => {
  const state = useWorkspaceStore.getState();
  // The previous session remains switchable if its named snapshot was deleted.
  const id = state.workspaces.some((item) => item.id === target.id) ? target.id : null;
  persist({ ...state, activeId: id, previous: { id: state.activeId, layout: outgoing }, drafts: collectDrafts(state, outgoing) });
  restoreLayout(target.layout);
};

export const createFreshWorkspace = (name: string, outgoing: WorkspaceLayout) => {
  const state = useWorkspaceStore.getState();
  const start = createSessionTab("");
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
