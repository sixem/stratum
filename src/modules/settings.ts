// Persistent user settings with defaults and coercion.
import { createWithEqualityFn } from "zustand/traditional";
import type { ViewMode } from "@/types";
import {
  GRID_AUTO_COLUMNS_DEFAULT,
  GRID_AUTO_COLUMNS_MAX,
  GRID_AUTO_COLUMNS_MIN,
  SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_VERSION,
  SIDEBAR_RECENT_LIMIT_MAX,
  SIDEBAR_RECENT_LIMIT_MIN,
} from "@/constants";
import type { KeybindMap } from "./keybinds";
import { coerceKeybinds, DEFAULT_KEYBINDS } from "./keybinds";

type ThumbnailFormat = "webp" | "jpeg";
export type ThumbnailFit = "cover" | "contain";
export type GridSize = "small" | "normal" | "large" | "auto";
export type GridNameEllipsis = "end" | "middle";
export type AccentTheme =
  | "red"
  | "purple"
  | "green"
  | "yellow"
  | "orange"
  | "teal"
  | "white";
export type SidebarSectionId = "places" | "recent" | "tips";

export const SIDEBAR_SECTION_DEFINITIONS: { id: SidebarSectionId; label: string }[] = [
  { id: "places", label: "Places" },
  { id: "recent", label: "Recent jumps" },
  { id: "tips", label: "Tips" },
];

export const DEFAULT_SIDEBAR_SECTION_ORDER = SIDEBAR_SECTION_DEFINITIONS.map((item) => item.id);
export const DEFAULT_SIDEBAR_HIDDEN_SECTIONS: SidebarSectionId[] = [];

type Settings = {
  sidebarOpen: boolean;
  sidebarRecentLimit: number;
  sidebarSectionOrder: SidebarSectionId[];
  sidebarHiddenSections: SidebarSectionId[];
  defaultViewMode: ViewMode;
  showTabNumbers: boolean;
  fixedWidthTabs: boolean;
  smoothScroll: boolean;
  compactMode: boolean;
  accentTheme: AccentTheme;
  categoryTinting: boolean;
  showParentEntry: boolean;
  confirmDelete: boolean;
  confirmClose: boolean;
  ambientBackground: boolean;
  blurOverlays: boolean;
  keybinds: KeybindMap;
  gridSize: GridSize;
  gridAutoColumns: number;
  gridRounded: boolean;
  gridCentered: boolean;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  menuOpenPwsh: boolean;
  menuOpenWsl: boolean;
  thumbnailsEnabled: boolean;
  thumbnailSize: number;
  thumbnailQuality: number;
  thumbnailFormat: ThumbnailFormat;
  thumbnailVideos: boolean;
  thumbnailCacheMb: number;
  thumbnailFit: ThumbnailFit;
  thumbnailAppIcons: boolean;
  ffmpegPath: string;
};

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

const DEFAULT_SETTINGS: Settings = {
  sidebarOpen: true,
  sidebarRecentLimit: 8,
  sidebarSectionOrder: DEFAULT_SIDEBAR_SECTION_ORDER,
  sidebarHiddenSections: DEFAULT_SIDEBAR_HIDDEN_SECTIONS,
  defaultViewMode: "thumbs",
  showTabNumbers: true,
  fixedWidthTabs: false,
  smoothScroll: false,
  compactMode: true,
  accentTheme: "red",
  categoryTinting: false,
  showParentEntry: true,
  confirmDelete: true,
  confirmClose: true,
  ambientBackground: false,
  blurOverlays: false,
  keybinds: DEFAULT_KEYBINDS,
  gridSize: "normal",
  gridAutoColumns: GRID_AUTO_COLUMNS_DEFAULT,
  gridRounded: true,
  gridCentered: true,
  gridShowSize: true,
  gridShowExtension: true,
  gridNameEllipsis: "middle",
  gridNameHideExtension: true,
  menuOpenPwsh: true,
  menuOpenWsl: false,
  thumbnailsEnabled: true,
  thumbnailSize: 256,
  thumbnailQuality: 80,
  thumbnailFormat: "webp",
  thumbnailVideos: true,
  thumbnailCacheMb: 512,
  thumbnailFit: "contain",
  thumbnailAppIcons: true,
  ffmpegPath: "",
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

const coerceFormat = (value: unknown): ThumbnailFormat => {
  return value === "jpeg" ? "jpeg" : "webp";
};

const coerceThumbnailFit = (value: unknown): ThumbnailFit => {
  return value === "contain" ? "contain" : "cover";
};

const coerceViewMode = (value: unknown): ViewMode => {
  return value === "list" ? "list" : "thumbs";
};

const coerceAccentTheme = (value: unknown): AccentTheme => {
  switch (value) {
    case "purple":
    case "green":
    case "yellow":
    case "orange":
    case "teal":
    case "white":
    case "red":
      return value;
    default:
      return DEFAULT_SETTINGS.accentTheme;
  }
};

const coerceGridSize = (value: unknown): GridSize => {
  if (value === "large" || value === "normal" || value === "small" || value === "auto") {
    return value;
  }
  return value === "compact" ? "small" : DEFAULT_SETTINGS.gridSize;
};

const coerceGridAutoColumns = (value: unknown): number => {
  return clampNumber(
    value,
    DEFAULT_SETTINGS.gridAutoColumns,
    GRID_AUTO_COLUMNS_MIN,
    GRID_AUTO_COLUMNS_MAX,
  );
};

const coerceGridNameEllipsis = (value: unknown): GridNameEllipsis => {
  return value === "middle" ? "middle" : "end";
};

const isSidebarSectionId = (value: unknown): value is SidebarSectionId => {
  return SIDEBAR_SECTION_DEFINITIONS.some((item) => item.id === value);
};

export const normalizeSidebarSectionOrder = (value: unknown): SidebarSectionId[] => {
  const next: SidebarSectionId[] = [];
  const seen = new Set<SidebarSectionId>();
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!isSidebarSectionId(item)) return;
      if (seen.has(item)) return;
      seen.add(item);
      next.push(item);
    });
  }
  SIDEBAR_SECTION_DEFINITIONS.forEach((item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    next.push(item.id);
  });
  return next;
};

export const normalizeSidebarHiddenSections = (value: unknown): SidebarSectionId[] => {
  const hidden: SidebarSectionId[] = [];
  if (!Array.isArray(value)) return hidden;
  const seen = new Set<SidebarSectionId>();
  value.forEach((item) => {
    if (!isSidebarSectionId(item)) return;
    if (seen.has(item)) return;
    seen.add(item);
    hidden.push(item);
  });
  return hidden;
};

const coerceSidebarRecentLimit = (value: unknown) => {
  return clampNumber(
    value,
    DEFAULT_SETTINGS.sidebarRecentLimit,
    SIDEBAR_RECENT_LIMIT_MIN,
    SIDEBAR_RECENT_LIMIT_MAX,
  );
};

const coerceSettings = (value: Partial<Settings> | null | undefined): Settings => {
  return {
    sidebarOpen:
      typeof value?.sidebarOpen === "boolean" ? value.sidebarOpen : DEFAULT_SETTINGS.sidebarOpen,
    sidebarRecentLimit: coerceSidebarRecentLimit(value?.sidebarRecentLimit),
    sidebarSectionOrder: normalizeSidebarSectionOrder(value?.sidebarSectionOrder),
    sidebarHiddenSections: normalizeSidebarHiddenSections(value?.sidebarHiddenSections),
    defaultViewMode: coerceViewMode(value?.defaultViewMode),
    showTabNumbers:
      typeof value?.showTabNumbers === "boolean"
        ? value.showTabNumbers
        : DEFAULT_SETTINGS.showTabNumbers,
    fixedWidthTabs:
      typeof value?.fixedWidthTabs === "boolean"
        ? value.fixedWidthTabs
        : DEFAULT_SETTINGS.fixedWidthTabs,
    smoothScroll:
      typeof value?.smoothScroll === "boolean"
        ? value.smoothScroll
        : DEFAULT_SETTINGS.smoothScroll,
    compactMode:
      typeof value?.compactMode === "boolean"
        ? value.compactMode
        : DEFAULT_SETTINGS.compactMode,
    accentTheme: coerceAccentTheme(value?.accentTheme),
    categoryTinting:
      typeof value?.categoryTinting === "boolean"
        ? value.categoryTinting
        : DEFAULT_SETTINGS.categoryTinting,
    showParentEntry:
      typeof value?.showParentEntry === "boolean"
        ? value.showParentEntry
        : DEFAULT_SETTINGS.showParentEntry,
    confirmDelete:
      typeof value?.confirmDelete === "boolean"
        ? value.confirmDelete
        : DEFAULT_SETTINGS.confirmDelete,
    confirmClose:
      typeof value?.confirmClose === "boolean"
        ? value.confirmClose
        : DEFAULT_SETTINGS.confirmClose,
    ambientBackground:
      typeof value?.ambientBackground === "boolean"
        ? value.ambientBackground
        : DEFAULT_SETTINGS.ambientBackground,
    blurOverlays:
      typeof value?.blurOverlays === "boolean"
        ? value.blurOverlays
        : DEFAULT_SETTINGS.blurOverlays,
    keybinds: coerceKeybinds(value?.keybinds),
    gridSize: coerceGridSize(value?.gridSize),
    gridAutoColumns: coerceGridAutoColumns(value?.gridAutoColumns),
    gridRounded:
      typeof value?.gridRounded === "boolean"
        ? value.gridRounded
        : DEFAULT_SETTINGS.gridRounded,
    gridCentered:
      typeof value?.gridCentered === "boolean"
        ? value.gridCentered
        : DEFAULT_SETTINGS.gridCentered,
    gridShowSize:
      typeof value?.gridShowSize === "boolean"
        ? value.gridShowSize
        : DEFAULT_SETTINGS.gridShowSize,
    gridShowExtension:
      typeof value?.gridShowExtension === "boolean"
        ? value.gridShowExtension
        : DEFAULT_SETTINGS.gridShowExtension,
    gridNameEllipsis: coerceGridNameEllipsis(value?.gridNameEllipsis),
    gridNameHideExtension:
      typeof value?.gridNameHideExtension === "boolean"
        ? value.gridNameHideExtension
        : DEFAULT_SETTINGS.gridNameHideExtension,
    menuOpenPwsh:
      typeof value?.menuOpenPwsh === "boolean"
        ? value.menuOpenPwsh
        : DEFAULT_SETTINGS.menuOpenPwsh,
    menuOpenWsl:
      typeof value?.menuOpenWsl === "boolean"
        ? value.menuOpenWsl
        : DEFAULT_SETTINGS.menuOpenWsl,
    thumbnailsEnabled:
      typeof value?.thumbnailsEnabled === "boolean"
        ? value.thumbnailsEnabled
        : DEFAULT_SETTINGS.thumbnailsEnabled,
    thumbnailSize: clampNumber(value?.thumbnailSize, DEFAULT_SETTINGS.thumbnailSize, 96, 320),
    thumbnailQuality: clampNumber(
      value?.thumbnailQuality,
      DEFAULT_SETTINGS.thumbnailQuality,
      50,
      95,
    ),
    thumbnailFormat: coerceFormat(value?.thumbnailFormat),
    thumbnailVideos:
      typeof value?.thumbnailVideos === "boolean"
        ? value.thumbnailVideos
        : DEFAULT_SETTINGS.thumbnailVideos,
    thumbnailCacheMb: clampNumber(
      value?.thumbnailCacheMb,
      DEFAULT_SETTINGS.thumbnailCacheMb,
      128,
      4096,
    ),
    thumbnailFit: coerceThumbnailFit(value?.thumbnailFit),
    thumbnailAppIcons:
      typeof value?.thumbnailAppIcons === "boolean"
        ? value.thumbnailAppIcons
        : DEFAULT_SETTINGS.thumbnailAppIcons,
    ffmpegPath:
      typeof value?.ffmpegPath === "string" ? value.ffmpegPath : DEFAULT_SETTINGS.ffmpegPath,
  };
};

// Map pre-v11 grid size labels to the new small/normal/large set.
const normalizeLegacySettings = (
  settings: Partial<Settings>,
  version: number | undefined,
): Partial<Settings> => {
  if (version != null && version >= STORAGE_VERSION) return settings;
  let next = settings;
  const legacyGridSize = next.gridSize as string | undefined;
  if (legacyGridSize === "large") {
    next = { ...next, gridSize: "normal" };
  } else if (legacyGridSize === "compact") {
    next = { ...next, gridSize: "small" };
  }
  if (!("sidebarHiddenSections" in next)) {
    const showTips =
      typeof (next as { sidebarShowTips?: boolean }).sidebarShowTips === "boolean"
        ? (next as { sidebarShowTips?: boolean }).sidebarShowTips
        : true;
    next = {
      ...next,
      sidebarHiddenSections: showTips ? [] : ["tips"],
    };
  }
  return next;
};

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
    thumbnailCacheMb: state.thumbnailCacheMb,
    thumbnailFit: state.thumbnailFit,
    thumbnailAppIcons: state.thumbnailAppIcons,
    ffmpegPath: state.ffmpegPath,
  });
});

export type { Settings };
