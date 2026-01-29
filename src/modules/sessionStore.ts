// Persistent session state for tabs and view settings.
import { createWithEqualityFn } from "zustand/traditional";
import type { SortDir, SortKey, SortState, Tab, ViewMode } from "@/types";
import { DEFAULT_SORT, getDefaultSortDir } from "@/lib";
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

type SessionStore = SessionState & {
  setTabs: (updater: Tab[] | ((prev: Tab[]) => Tab[])) => void;
  setActiveTabId: (id: string | null) => void;
  setRecentJumps: (updater: string[] | ((prev: string[]) => string[])) => void;
  updateSession: (patch: Partial<SessionState>) => void;
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
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const tab = item as {
        id?: unknown;
        path?: unknown;
        crumbTrailPath?: unknown;
        viewMode?: unknown;
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
        sort: coerceSort(tab.sort),
        search: coerceSearch(tab.search),
        scrollTop: coerceScrollTop(tab.scrollTop),
      };
    })
    .filter((item): item is Tab => Boolean(item));
};

const coerceSession = (value: Partial<SessionState> | null | undefined): SessionState => {
  const tabs = coerceTabs(value?.tabs);
  const activeTabId =
    typeof value?.activeTabId === "string" && tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId
      : tabs[0]?.id ?? null;
  const recentJumps = Array.isArray(value?.recentJumps)
    ? value.recentJumps.filter((item) => typeof item === "string")
    : [];
  return {
    tabs,
    activeTabId,
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

const readStoredSession = () => {
  try {
    if (!("localStorage" in globalThis)) {
      return DEFAULT_SESSION;
    }
    const storage = globalThis.localStorage;
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      return parseStoredSession(raw);
    }
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return DEFAULT_SESSION;
    const session = parseStoredSession(legacy);
    // Migrate legacy storage to the new key so tab sort stays persistent.
    writeStoredSession(session);
    storage.removeItem(LEGACY_STORAGE_KEY);
    return session;
  } catch {
    return DEFAULT_SESSION;
  }
};

const writeStoredSession = (session: SessionState) => {
  try {
    if (!("localStorage" in globalThis)) return;
    const payload: StoredSession = { version: STORAGE_VERSION, session };
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
};

const applyUpdater = <T,>(value: T, updater: T | ((prev: T) => T)) => {
  return typeof updater === "function" ? (updater as (prev: T) => T)(value) : updater;
};

export const useSessionStore = createWithEqualityFn<SessionStore>((set) => ({
  ...readStoredSession(),
  setTabs: (updater) =>
    set((state) => ({
      tabs: applyUpdater(state.tabs, updater),
    })),
  setActiveTabId: (id) => set({ activeTabId: id }),
  setRecentJumps: (updater) =>
    set((state) => ({
      recentJumps: applyUpdater(state.recentJumps, updater),
    })),
  updateSession: (patch) => set((state) => ({ ...state, ...patch })),
  resetSession: () => set({ ...DEFAULT_SESSION }),
}));

useSessionStore.subscribe((state) => {
  writeStoredSession({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    recentJumps: state.recentJumps,
  });
});

export type { SessionState };
