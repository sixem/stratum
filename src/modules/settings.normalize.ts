// Normalizes persisted settings payloads into safe, typed values.
import type { ViewMode } from "@/types";
import {
  GRID_AUTO_COLUMNS_MAX,
  GRID_AUTO_COLUMNS_MIN,
  GRID_GAP_MAX,
  GRID_GAP_MIN,
  SETTINGS_STORAGE_VERSION,
  SIDEBAR_RECENT_LIMIT_MAX,
  SIDEBAR_RECENT_LIMIT_MIN,
} from "@/constants";
import { coerceKeybinds } from "./keybinds";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SIDEBAR_HIDDEN_SECTIONS,
  SIDEBAR_SECTION_DEFINITIONS,
} from "./settings.defaults";
import type {
  AccentTheme,
  GridNameEllipsis,
  GridSize,
  Settings,
  SidebarSectionId,
  ThumbnailFit,
  ThumbnailFormat,
} from "./settings.types";

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

const coerceGridGap = (value: unknown): number => {
  return clampNumber(value, DEFAULT_SETTINGS.gridGap, GRID_GAP_MIN, GRID_GAP_MAX);
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

export const coerceSettings = (value: Partial<Settings> | null | undefined): Settings => {
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
    gridGap: coerceGridGap(value?.gridGap),
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
    thumbnailSvgs:
      typeof value?.thumbnailSvgs === "boolean"
        ? value.thumbnailSvgs
        : DEFAULT_SETTINGS.thumbnailSvgs,
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
export const normalizeLegacySettings = (
  settings: Partial<Settings>,
  version: number | undefined,
): Partial<Settings> => {
  if (version != null && version >= SETTINGS_STORAGE_VERSION) return settings;
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
      sidebarHiddenSections: showTips ? DEFAULT_SIDEBAR_HIDDEN_SECTIONS : ["tips"],
    };
  }
  return next;
};
