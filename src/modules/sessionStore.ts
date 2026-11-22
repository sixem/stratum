// Persistent session state for tabs and view settings.
import { createWithEqualityFn } from "zustand/traditional";
import type { SortDir, SortKey, SortState, Tab, ViewMode } from "@/types";
import type { TabHistory } from "@/types/tabs";
import { createTab, DEFAULT_SORT, getDefaultSortDir } from "@/lib";
import { useSettingsStore } from "./settings.store";
import type { FixedGridSize } from "./settings.types";
import { coerceTabGridSize, fillTabGridSizes, getDefaultTabGridSize, getTabGridSizeOnEnable } from "./tabGridSize";
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
  setTabGridSize: (id: string, gridSize: FixedGridSize) => void;
  setTabScrollTop: (id: string, scrollTop: number) => void;
  setActiveTabId: (id: string | null) => void;
  setRecentJumps: (updater: string[] | ((prev: string[]) => string[])) => void;
  updateSession: (patch: Partial<SessionRuntimeState>) => void;
  restoreSession: (layout: SessionState) => void;
  resetSession: () => void;
};

type StoredSession = {
  version: number;
  session: SessionState;
};

const STORAGE_KEY = SESSION_STORAGE_KEY;
const LEGACY_STORAGE_KEY = SESSION_LEGACY_STORAGE_KEY;
const STORAGE_VERSION = SESSION_STORAGE_VERSION;

const DEFAULT_SESSION: SessionState = {
  tabs: [],
  activeTabId: null,
  recentJumps: [],
};

export const createSessionTab = (...args: Parameters<typeof createTab>): Tab => ({
  ...createTab(...args),
  gridSize: getDefaultTabGridSize(useSettingsStore.getState()),
});

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
  return value
    .map<Tab | null>((item) => {
      if (!item || typeof item !== "object") return null;
      const tab = item as {
        id?: unknown;
        path?: unknown;
        crumbTrailPath?: unknown;
        viewMode?: unknown;
        gridSize?: unknown;
        sort?: unknown;
        search?: unknown;
        scrollTop?: unknown;
      };
      if (typeof tab.id !== "string" || typeof tab.path !== "string") return null;
      return {
        id: tab.id,
        path: tab.path,
        crumbTrailPath: coerceCrumbTrailPath(tab.crumbTrailPath, tab.path),
        viewMode: coerceViewMode(tab.viewMode),
        gridSize: coerceTabGridSize(tab.gridSize),
        sort: coerceSort(tab.sort),
        search: coerceSearch(tab.search),
        scrollTop: coerceScrollTop(tab.scrollTop),
      };
    })
    .filter((item): item is Tab => Boolean(item));
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
      return parseStoredSession(raw);
    }
    if (key !== STORAGE_KEY) return DEFAULT_SESSION;
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return DEFAULT_SESSION;
    const session = parseStoredSession(legacy);
    // Migrate legacy storage to the new key so tab sort stays persistent.
    writeStoredSession(key, session);
    storage.removeItem(LEGACY_STORAGE_KEY);
    return session;
  } catch {
    return DEFAULT_SESSION;
  }
};

const writeStoredSession = (key: string, session: SessionState) => {
  try {
    if (!("localStorage" in globalThis)) return;
    const payload: StoredSession = { version: STORAGE_VERSION, session };
    globalThis.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
};

const applyUpdater = <T,>(value: T, updater: T | ((prev: T) => T)) => {
  return typeof updater === "function" ? (updater as (prev: T) => T)(value) : updater;
};

const createSessionStore = (key: string) => {
  const store = createWithEqualityFn<SessionStore>((set) => ({
    ...readStoredSession(key),
    // Keep undo history for this pane even if its view unmounts.
    closedTabs: [],
    restoreRevision: 0,
    setTabs: (updater) =>
      set((state) => ({
        tabs: applyUpdater(state.tabs, updater),
      })),
    setTabGridSize: (id, gridSize) => set((state) => {
      const index = state.tabs.findIndex(tab => tab.id === id);
      if (index < 0 || state.tabs[index].gridSize === gridSize) return state;
      const tabs = state.tabs.slice();
      tabs[index] = { ...tabs[index], gridSize };
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
    restoreSession: (layout) => {
      const activeIndex = layout.tabs.findIndex((tab) => tab.id === layout.activeTabId);
      // Each restore is a new visit, even if it reopens the same saved tab.
      const tabs = fillTabGridSizes(layout.tabs, getDefaultTabGridSize(useSettingsStore.getState()))
        .map((tab) => ({ ...tab, id: createTab(tab.path).id, sort: { ...tab.sort } }));
      set((state) => ({
        tabs,
        activeTabId: (tabs[activeIndex] ?? tabs[0])?.id ?? null,
        recentJumps: [...layout.recentJumps],
        closedTabs: [],
        restoreRevision: state.restoreRevision + 1,
      }));
    },
    resetSession: () => set({ ...DEFAULT_SESSION, closedTabs: [] }),
  }));

  store.subscribe((state) => {
    writeStoredSession(key, {
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      recentJumps: state.recentJumps,
    });
  });
  const fillGridSizes = (gridSize: FixedGridSize | undefined) => {
    if (!gridSize) return;
    store.setState((state) => {
      const tabs = fillTabGridSizes(state.tabs, gridSize);
      const closedTabs = state.closedTabs.some(({ tab }) => !tab.gridSize)
        ? state.closedTabs.map(closed => closed.tab.gridSize ? closed : { ...closed, tab: { ...closed.tab, gridSize } })
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

export const getPaneSessionStore = (pane: "main" | "bottom") =>
  pane === "bottom" ? useBottomSessionStore : useSessionStore;

export type { SessionState };
