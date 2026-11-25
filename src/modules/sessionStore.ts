// Persistent session state for tabs and view settings.
import { createWithEqualityFn } from "zustand/traditional";
import type { SortDir, SortKey, SortState, Tab, ViewMode } from "@/types";
import type { FolderTab, TabHistory, TerminalSession, TerminalTab } from "@/types/tabs";
import { createTab, DEFAULT_SORT, getDefaultSortDir } from "@/lib";
import { readTabContent, selectRestoredFolder } from "@/lib/tabRestore";
import { resolveDefaultViewMode, useSettingsStore } from "./settings.store";
import {
  coerceTabAutoColumns, coerceTabGridSize, fillTabGridSizes, getDefaultTabGridSize, getTabGridSizeOnEnable,
  readTabGridSize, seedTabGridSize, withTabGridSize, type TabGridSize,
} from "./tabGridSize";
import {
  SESSION_LEGACY_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  SESSION_STORAGE_VERSION,
  SIDEBAR_RECENT_LIMIT_MAX,
} from "@/constants";

type SessionState = {
  tabs: Tab[];
  activeTabId: string | null;
  recentJumps: string[];
};

export type TabLayout = Pick<SessionState, "tabs" | "activeTabId">;

type ClosedTab = {
  tab: Tab;
  index: number;
  history?: TabHistory;
};

type SessionRuntimeState = SessionState & { closedTabs: ClosedTab[]; restoreRevision: number };

type SessionStore = SessionRuntimeState & {
  setTabs: (updater: Tab[] | ((prev: Tab[]) => Tab[])) => void;
  setTabSearch: (id: string, search: string) => void;
  setTabGridSize: (id: string, size: TabGridSize) => void;
  setTabScrollTop: (id: string, scrollTop: number) => void;
  setActiveTabId: (id: string | null) => void;
  setRecentJumps: (updater: string[] | ((prev: string[]) => string[])) => void;
  updateSession: (patch: Partial<SessionRuntimeState>) => void;
  restoreSession: (layout: SessionState) => void;
  resetSession: () => void;
  flushPendingWrite: () => void;
};

type StoredSession = {
  version: number;
  session: SessionState;
};

const STORAGE_KEY = SESSION_STORAGE_KEY;
const LEGACY_STORAGE_KEY = SESSION_LEGACY_STORAGE_KEY;
const STORAGE_VERSION = SESSION_STORAGE_VERSION;
const FILTER_SAVE_DELAY_MS = 250;

const DEFAULT_SESSION: SessionState = {
  tabs: [],
  activeTabId: null,
  recentJumps: [],
};

export const createSessionTab = (path: string, base?: Partial<Pick<Tab, "sort" | "search">>): FolderTab => {
  const settings = useSettingsStore.getState();
  const tab = createTab(path, { ...base, sort: settings.newTabSort ?? base?.sort, viewMode: resolveDefaultViewMode(settings) });
  return seedTabGridSize(tab, getDefaultTabGridSize(settings));
};

export const createTerminalSessionTab = (shell: string | TerminalSession): TerminalTab => {
  const tab = createSessionTab("");
  const terminal = typeof shell === "string" ? { key: tab.id, directory: shell } : shell;
  return { ...tab, kind: "terminal", terminal, split: undefined };
};

const restoreFolderSelection = (session: SessionState): SessionState => ({
  ...session,
  ...selectRestoredFolder(session, () => createSessionTab("")),
});

// A restore is a new visit, even if it opens the same saved tab.
export const prepareSessionRestore = (layout: SessionState, gridSize: TabGridSize | undefined): SessionState => {
  const activeIndex = layout.tabs.findIndex((tab) => tab.id === layout.activeTabId);
  const tabs = fillTabGridSizes(layout.tabs, gridSize)
    .map<Tab>((tab) => {
      const id = createTab(tab.path).id;
      const copy = { id, sort: { ...tab.sort } };
      if (tab.kind === "terminal") return { ...tab, ...copy, terminal: { ...tab.terminal, key: id } };
      const split = tab.split && { ...tab.split, terminal: { ...tab.split.terminal, key: id } };
      return { ...tab, ...copy, split };
    });
  return restoreFolderSelection({ tabs, activeTabId: tabs[activeIndex]?.id ?? null, recentJumps: [...layout.recentJumps] });
};

const coerceViewMode = (value: unknown): ViewMode => {
  return value === "list" ? "list" : "thumbs";
};

const coerceSortKey = (value: unknown): SortKey => {
  if (value === "size" || value === "modified") return value;
  return "name";
};

const coerceSortDir = (value: unknown, key: SortKey): SortDir => {
  if (value === "desc" || value === "asc") return value;
  return getDefaultSortDir(key);
};

const coerceSort = (value: unknown): SortState => {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SORT };
  }
  const raw = value as { key?: unknown; dir?: unknown };
  const key = coerceSortKey(raw.key);
  return {
    key,
    dir: coerceSortDir(raw.dir, key),
  };
};

const coerceSearch = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

// Keep the stored crumb trail if valid; otherwise fall back to the tab path.
const coerceCrumbTrailPath = (value: unknown, fallback: string): string => {
  return typeof value === "string" ? value : fallback;
};

const coerceScrollTop = (value: unknown): number => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
};

const coerceTabs = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const tabs = value
    .map<Tab | null>((item) => {
      if (!item || typeof item !== "object") return null;
      const tab = item as {
        id?: unknown;
        path?: unknown;
        kind?: unknown;
        anchored?: unknown;
        terminal?: unknown;
        split?: unknown;
        crumbTrailPath?: unknown;
        viewMode?: unknown;
        gridSize?: unknown;
        gridAutoColumns?: unknown;
        sort?: unknown;
        search?: unknown;
        scrollTop?: unknown;
      };
      if (typeof tab.id !== "string" || typeof tab.path !== "string") return null;
      const content = readTabContent(tab, tab.id);
      if (!content) return null;
      const path = content.kind === "terminal" ? "" : tab.path;
      return {
        id: tab.id,
        ...content,
        path,
        anchored: tab.anchored === true ? true : undefined,
        crumbTrailPath: content.kind === "terminal" ? "" : coerceCrumbTrailPath(tab.crumbTrailPath, path),
        viewMode: coerceViewMode(tab.viewMode),
        gridSize: coerceTabGridSize(tab.gridSize),
        gridAutoColumns: coerceTabAutoColumns(tab.gridAutoColumns),
        sort: coerceSort(tab.sort),
        search: coerceSearch(tab.search),
        scrollTop: coerceScrollTop(tab.scrollTop),
      };
    })
    .filter((item): item is Tab => Boolean(item));
  return [...tabs.filter(tab => tab.anchored), ...tabs.filter(tab => !tab.anchored)];
};

const coerceTabLayout = (value: Partial<TabLayout> | null | undefined): TabLayout => {
  const tabs = coerceTabs(value?.tabs);
  const activeTabId =
    typeof value?.activeTabId === "string" && tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId
      : tabs[0]?.id ?? null;
  return { tabs, activeTabId };
};

export const coerceSession = (value: Partial<SessionState> | null | undefined): SessionState => {
  const recentJumps = Array.isArray(value?.recentJumps)
    ? value.recentJumps.filter((item) => typeof item === "string")
    : [];
  return {
    ...coerceTabLayout(value),
    recentJumps: recentJumps.slice(0, SIDEBAR_RECENT_LIMIT_MAX),
  };
};

const parseStoredSession = (raw: string): SessionState => {
  const parsed = JSON.parse(raw) as StoredSession | Partial<SessionState>;
  if ("session" in parsed) {
    return coerceSession(parsed.session);
  }
  return coerceSession(parsed);
};

const readStoredSession = (key: string) => {
  try {
    if (!("localStorage" in globalThis)) {
      return DEFAULT_SESSION;
    }
    const storage = globalThis.localStorage;
    const raw = storage.getItem(key);
    if (raw) {
      return restoreFolderSelection(parseStoredSession(raw));
    }
    if (key !== STORAGE_KEY) return DEFAULT_SESSION;
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return DEFAULT_SESSION;
    const session = restoreFolderSelection(parseStoredSession(legacy));
    // Migrate legacy storage to the new key so tab sort stays persistent.
    writeStoredSession(key, session);
    storage.removeItem(LEGACY_STORAGE_KEY);
    return session;
  } catch {
    return DEFAULT_SESSION;
  }
};

// A running shell belongs to this window. Closing its split leaves a folder tab.
export function folderWithoutTerminal(tab: Tab): Tab {
  if (!tab.split) return tab;
  const { split, ...folder } = tab;
  return folder;
}

const serializeSession = (key: string, session: SessionState) => {
  const { tabs, activeTabId, recentJumps } = session;
  const payload: StoredSession = { version: STORAGE_VERSION, session: { tabs, activeTabId, recentJumps } };
  return [key, JSON.stringify(payload)] as const;
};

export const serializePaneSession = (pane: "main" | "bottom", session: SessionState) =>
  serializeSession(pane === "main" ? STORAGE_KEY : `${STORAGE_KEY}.bottom`, session);

const writeStoredSession = (key: string, session: SessionState) => {
  try {
    if (!("localStorage" in globalThis)) return;
    globalThis.localStorage.setItem(...serializeSession(key, session));
  } catch {
    // Ignore storage errors.
  }
};

const applyUpdater = <T,>(value: T, updater: T | ((prev: T) => T)) => {
  return typeof updater === "function" ? (updater as (prev: T) => T)(value) : updater;
};

const createSessionStore = (key: string) => {
  let filterEditTabs: Tab[] | undefined;
  let filterSaveTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelFilterSave = () => {
    if (filterSaveTimer === undefined) return;
    clearTimeout(filterSaveTimer);
    filterSaveTimer = undefined;
  };

  const flushPendingWrite = () => {
    if (filterSaveTimer === undefined) return;
    cancelFilterSave();
    writeStoredSession(key, store.getState());
  };

  const store = createWithEqualityFn<SessionStore>((set) => ({
    ...readStoredSession(key),
    // Keep undo history for this pane even if its view unmounts.
    closedTabs: [],
    restoreRevision: 0,
    setTabs: (updater) =>
      set((state) => {
        const tabs = applyUpdater(state.tabs, updater);
        return tabs === state.tabs ? state : { tabs };
      }),
    setTabSearch: (id, search) => set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index < 0 || state.tabs[index].search === search) return state;
      const tabs = state.tabs.slice();
      tabs[index] = { ...tabs[index], search };
      // Mark this update for the synchronous persistence subscriber.
      filterEditTabs = tabs;
      return { tabs };
    }),
    setTabGridSize: (id, size) => set((state) => {
      const index = state.tabs.findIndex(tab => tab.id === id);
      if (index < 0) return state;
      const tab = withTabGridSize(state.tabs[index], size);
      if (tab === state.tabs[index]) return state;
      const tabs = state.tabs.slice();
      tabs[index] = tab;
      return { tabs };
    }),
    setTabScrollTop: (id, scrollTop) => set((state) => {
      if (!id) return state;
      const index = state.tabs.findIndex(tab => tab.id === id);
      const nextTop = coerceScrollTop(scrollTop);
      if (index < 0 || state.tabs[index].scrollTop === nextTop) return state;
      const tabs = state.tabs.slice();
      tabs[index] = { ...tabs[index], scrollTop: nextTop };
      return { tabs };
    }),
    setActiveTabId: (id) => set({ activeTabId: id }),
    setRecentJumps: (updater) =>
      set((state) => ({
        recentJumps: applyUpdater(state.recentJumps, updater),
      })),
    updateSession: (patch) => set((state) => ({ ...state, ...patch })),
    restoreSession: (prepared) => set((state) => ({
      ...prepared,
      closedTabs: [],
      restoreRevision: state.restoreRevision + 1,
    })),
    resetSession: () => set({ ...DEFAULT_SESSION, closedTabs: [] }),
    flushPendingWrite,
  }));

  store.subscribe((state, previous) => {
    if (state.tabs === previous.tabs && state.activeTabId === previous.activeTabId &&
        state.recentJumps === previous.recentJumps) return;

    cancelFilterSave();
    if (state.tabs === filterEditTabs) {
      filterEditTabs = undefined;
      filterSaveTimer = setTimeout(flushPendingWrite, FILTER_SAVE_DELAY_MS);
      return;
    }

    // Navigation and workspace restores write the latest session immediately.
    writeStoredSession(key, state);
  });
  const fillGridSizes = (gridSize: TabGridSize | undefined) => {
    if (gridSize === undefined) return;
    store.setState((state) => {
      const tabs = fillTabGridSizes(state.tabs, gridSize);
      const closedTabs = state.closedTabs.some(({ tab }) => readTabGridSize(tab, gridSize) === undefined)
        ? state.closedTabs.map(closed => ({ ...closed, tab: seedTabGridSize(closed.tab, gridSize) }))
        : state.closedTabs;
      return tabs === state.tabs && closedTabs === state.closedTabs ? state : { tabs, closedTabs };
    });
  };
  fillGridSizes(getDefaultTabGridSize(useSettingsStore.getState()));
  useSettingsStore.subscribe((next, previous) => fillGridSizes(getTabGridSizeOnEnable(next, previous)));
  return store;
};

export const useSessionStore = createSessionStore(STORAGE_KEY);
export const useBottomSessionStore = createSessionStore(STORAGE_KEY + ".bottom");

export const flushPendingSessionWrites = () => {
  useSessionStore.getState().flushPendingWrite();
  useBottomSessionStore.getState().flushPendingWrite();
};

export const getPaneSessionStore = (pane: "main" | "bottom") =>
  pane === "bottom" ? useBottomSessionStore : useSessionStore;

export type { SessionState };
