// Settings store wiring for persistence and updates.
import { createWithEqualityFn } from "zustand/traditional";
import {
  SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_VERSION,
} from "@/constants";
import { coerceKeybinds, DEFAULT_KEYBINDS } from "./keybinds";
import { DEFAULT_SETTINGS } from "./settings.defaults";
import { coerceSettings, normalizeLegacySettings } from "./settings.normalize";
import type { Settings } from "./settings.types";

type SettingsStore = Settings & {
  setSettings: (next: Settings) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
};

type StoredSettings = {
  version: number;
  settings: Settings;
};

const STORAGE_KEY = SETTINGS_STORAGE_KEY;
const STORAGE_VERSION = SETTINGS_STORAGE_VERSION;

const readStoredSettings = () => {
  try {
    if (!("localStorage" in globalThis)) {
      return DEFAULT_SETTINGS;
    }
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as StoredSettings | Partial<Settings>;
    if ("settings" in parsed) {
      const normalized = normalizeLegacySettings(parsed.settings, parsed.version);
      return coerceSettings(normalized);
    }
    const normalized = normalizeLegacySettings(parsed, undefined);
    return coerceSettings(normalized);
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const writeStoredSettings = (settings: Settings) => {
  try {
    if (!("localStorage" in globalThis)) return;
    const payload: StoredSettings = { version: STORAGE_VERSION, settings };
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors (private mode, denied, etc.).
  }
};

export const useSettingsStore = createWithEqualityFn<SettingsStore>((set) => ({
  ...readStoredSettings(),
  setSettings: (next) =>
    set({ ...next, keybinds: coerceKeybinds(next.keybinds) }),
  updateSettings: (patch) =>
    set((state) => ({
      ...state,
      ...patch,
      keybinds: patch.keybinds ? coerceKeybinds(patch.keybinds) : state.keybinds,
    })),
  resetSettings: () => set({ ...DEFAULT_SETTINGS, keybinds: DEFAULT_KEYBINDS }),
}));

useSettingsStore.subscribe((state) => {
  writeStoredSettings({
    sidebarOpen: state.sidebarOpen,
    sidebarRecentLimit: state.sidebarRecentLimit,
    sidebarSectionOrder: state.sidebarSectionOrder,
    sidebarHiddenSections: state.sidebarHiddenSections,
    defaultViewMode: state.defaultViewMode,
    showTabNumbers: state.showTabNumbers,
    fixedWidthTabs: state.fixedWidthTabs,
    smoothScroll: state.smoothScroll,
    compactMode: state.compactMode,
    accentTheme: state.accentTheme,
    categoryTinting: state.categoryTinting,
    showParentEntry: state.showParentEntry,
    confirmDelete: state.confirmDelete,
    confirmClose: state.confirmClose,
    ambientBackground: state.ambientBackground,
    blurOverlays: state.blurOverlays,
    keybinds: state.keybinds,
    gridSize: state.gridSize,
    gridAutoColumns: state.gridAutoColumns,
    gridGap: state.gridGap,
    gridRounded: state.gridRounded,
    gridCentered: state.gridCentered,
    gridShowSize: state.gridShowSize,
    gridShowExtension: state.gridShowExtension,
    gridNameEllipsis: state.gridNameEllipsis,
    gridNameHideExtension: state.gridNameHideExtension,
    menuOpenPwsh: state.menuOpenPwsh,
    menuOpenWsl: state.menuOpenWsl,
    thumbnailsEnabled: state.thumbnailsEnabled,
    thumbnailSize: state.thumbnailSize,
    thumbnailQuality: state.thumbnailQuality,
    thumbnailFormat: state.thumbnailFormat,
    thumbnailVideos: state.thumbnailVideos,
    thumbnailSvgs: state.thumbnailSvgs,
    thumbnailCacheMb: state.thumbnailCacheMb,
    thumbnailFit: state.thumbnailFit,
    thumbnailAppIcons: state.thumbnailAppIcons,
    ffmpegPath: state.ffmpegPath,
  });
});
