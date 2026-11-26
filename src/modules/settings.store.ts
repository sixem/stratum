// Settings store wiring for persistence and updates.
import { createWithEqualityFn } from "zustand/traditional";
import {
  BOTTOM_PANE_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_VERSION,
} from "@/constants/settings";
import { coerceKeybinds, DEFAULT_KEYBINDS } from "./keybinds";
import { DEFAULT_SETTINGS, DEFAULT_VIEW_MODE } from "./settings.defaults";
import { coerceRememberedViewMode, coerceSettings, normalizeLegacySettings } from "./settings.normalize";
import type { Settings } from "./settings.types";

type SettingsStore = Settings & {
  setSettings: (next: Settings) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
};

type StoredSettings = {
  version: number;
  settings: Partial<Settings>;
};

const STORAGE_KEY = SETTINGS_STORAGE_KEY;
const STORAGE_VERSION = SETTINGS_STORAGE_VERSION;

export const resolveDefaultViewMode = ({ defaultViewMode, lastUsedViewMode }: Pick<Settings, "defaultViewMode" | "lastUsedViewMode">) =>
  defaultViewMode === "last" ? lastUsedViewMode ?? DEFAULT_VIEW_MODE : defaultViewMode;

const readLegacyBottomView = (storage: Storage) => {
  try {
    const raw = storage.getItem(BOTTOM_PANE_STORAGE_KEY);
    const pane = raw ? JSON.parse(raw) as { state?: { defaultViewMode?: unknown } } | null : null;
    return coerceRememberedViewMode(pane?.state?.defaultViewMode);
  } catch {
    return null;
  }
};

const readSettingsPayload = (raw: string | null) => {
  const parsed = raw ? JSON.parse(raw) as StoredSettings | Partial<Settings> : {};
  return "settings" in parsed
    ? normalizeLegacySettings(parsed.settings, parsed.version)
    : normalizeLegacySettings(parsed, undefined);
};

export const hasStoredIndexingPreference = () => {
  try {
    const stored = readSettingsPayload(globalThis.localStorage.getItem(STORAGE_KEY));
    return typeof stored.indexedSearchEnabled === "boolean";
  } catch {
    return false;
  }
};

const readStoredSettings = () => {
  try {
    if (!("localStorage" in globalThis)) {
      return DEFAULT_SETTINGS;
    }
    const storage = globalThis.localStorage;
    const raw = storage.getItem(STORAGE_KEY);
    const normalized = readSettingsPayload(raw);
    const settings = raw ? coerceSettings(normalized) : { ...DEFAULT_SETTINGS };
    if (normalized.lastUsedViewMode === undefined) {
      // The bottom pane held the only remembered view in older profiles.
      const remembered = readLegacyBottomView(storage);
      if (remembered) {
        settings.lastUsedViewMode = remembered;
        // Leave an unset indexing preference available for its own migration.
        writeStoredSettings({ ...settings, indexedSearchEnabled: normalized.indexedSearchEnabled });
      }
    }
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const serializeSettings = (settings: Partial<Settings>) => {
  const payload: StoredSettings = { version: STORAGE_VERSION, settings };
  return [STORAGE_KEY, JSON.stringify(payload)] as const;
};

const writeStoredSettings = (settings: Partial<Settings>) => {
  try {
    if (!("localStorage" in globalThis)) return;
    globalThis.localStorage.setItem(...serializeSettings(settings));
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
    autoCheckUpdates: state.autoCheckUpdates,
    updateDelayHours: state.updateDelayHours,
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
    sidebarRecentLimit: state.sidebarRecentLimit,
    sidebarSectionOrder: state.sidebarSectionOrder,
    sidebarHiddenSections: state.sidebarHiddenSections,
    defaultViewMode: state.defaultViewMode,
    lastUsedViewMode: state.lastUsedViewMode,
    startupMode: state.startupMode,
    startupWorkspaceId: state.startupWorkspaceId,
    newTabSort: state.newTabSort,
    rememberRecentLocations: state.rememberRecentLocations,
    showTabNumbers: state.showTabNumbers,
    fixedWidthTabs: state.fixedWidthTabs,
    animateTabChanges: state.animateTabChanges,
    wrapTabNavigation: state.wrapTabNavigation,
    tabDropSubfolders: state.tabDropSubfolders,
    tabDropParentFolder: state.tabDropParentFolder,
    showRecycleBinButton: state.showRecycleBinButton,
    showDriveToggle: state.showDriveToggle,
    collapseDrivePickerOnBlur: state.collapseDrivePickerOnBlur,
    showTopbarFolderChevrons: state.showTopbarFolderChevrons,
    showWorkProgressFill: state.showWorkProgressFill,
    smoothScroll: state.smoothScroll,
    smartTabJump: state.smartTabJump,
    terminalTabNavigation: state.terminalTabNavigation,
    accentTheme: state.accentTheme,
    terminalTheme: state.terminalTheme,
    terminalFontFamily: state.terminalFontFamily,
    terminalFontSize: state.terminalFontSize,
    terminalFontWeight: state.terminalFontWeight,
    terminalCursorStyle: state.terminalCursorStyle,
    terminalScrollback: state.terminalScrollback,
    darkMode: state.darkMode,
    categoryTinting: state.categoryTinting,
    showParentEntry: state.showParentEntry,
    keepFilterOnNavigation: state.keepFilterOnNavigation,
    confirmDelete: state.confirmDelete,
    confirmClose: state.confirmClose,
    warnOnUnsavedWorkspaces: state.warnOnUnsavedWorkspaces,
    ambientBackground: state.ambientBackground,
    blurOverlays: state.blurOverlays,
    showTooltips: state.showTooltips,
    keybinds: state.keybinds,
    gridSize: state.gridSize,
    rememberTabGridSize: state.rememberTabGridSize,
    gridAutoColumns: state.gridAutoColumns,
    gridGap: state.gridGap,
    gridRounded: state.gridRounded,
    gridCentered: state.gridCentered,
    gridShowSize: state.gridShowSize,
    gridShowExtension: state.gridShowExtension,
    gridNameEllipsis: state.gridNameEllipsis,
    gridNameHideExtension: state.gridNameHideExtension,
    listDensity: state.listDensity,
    listShowSize: state.listShowSize,
    listShowModified: state.listShowModified,
    menuUseWindowsForItems: state.menuUseWindowsForItems,
    menuOpenPwsh: state.menuOpenPwsh,
    menuOpenWsl: state.menuOpenWsl,
    menuShowConvert: state.menuShowConvert,
    menuPaneTransfers: state.menuPaneTransfers,
    menuSelectionActions: state.menuSelectionActions,
    menuOpenBackgroundTab: state.menuOpenBackgroundTab,
    hiddenContextMenuActions: state.hiddenContextMenuActions,
    rememberMoveDestinations: state.rememberMoveDestinations,
    recentMoveLimit: state.recentMoveLimit,
    indexedSearchEnabled: state.indexedSearchEnabled,
    excludedIndexedDrives: state.excludedIndexedDrives,
    thumbnailsEnabled: state.thumbnailsEnabled,
    thumbnailSize: state.thumbnailSize,
    thumbnailQuality: state.thumbnailQuality,
    thumbnailFormat: state.thumbnailFormat,
    thumbnailFolders: state.thumbnailFolders,
    thumbnailVideos: state.thumbnailVideos,
    thumbnailSvgs: state.thumbnailSvgs,
    thumbnailCacheMb: state.thumbnailCacheMb,
    thumbnailFit: state.thumbnailFit,
    thumbnailAppIcons: state.thumbnailAppIcons,
    videoAutoplay: state.videoAutoplay,
    galleryAudio: state.galleryAudio,
    ffmpegPath: state.ffmpegPath,
  });
});
