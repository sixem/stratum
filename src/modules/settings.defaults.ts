// Default values and sidebar definitions for settings storage.
import {
  GRID_AUTO_COLUMNS_DEFAULT,
  GRID_GAP_DEFAULT,
} from "@/constants";
import { DEFAULT_KEYBINDS } from "./keybinds";
import type { Settings, SidebarSectionId } from "./settings.types";

export const SIDEBAR_SECTION_DEFINITIONS: { id: SidebarSectionId; label: string }[] = [
  { id: "places", label: "Places" },
  { id: "recent", label: "Recent jumps" },
  { id: "tips", label: "Tips" },
];

export const DEFAULT_SIDEBAR_SECTION_ORDER = SIDEBAR_SECTION_DEFINITIONS.map(
  (item) => item.id,
);
export const DEFAULT_SIDEBAR_HIDDEN_SECTIONS: SidebarSectionId[] = [];

export const DEFAULT_SETTINGS: Settings = {
  sidebarOpen: true,
  sidebarRecentLimit: 10,
  sidebarSectionOrder: DEFAULT_SIDEBAR_SECTION_ORDER,
  sidebarHiddenSections: DEFAULT_SIDEBAR_HIDDEN_SECTIONS,
  defaultViewMode: "thumbs",
  showTabNumbers: false,
  fixedWidthTabs: false,
  tabDropSubfolders: false,
  showRecycleBinButton: false,
  smoothScroll: false,
  smartTabJump: true,
  accentTheme: "red",
  categoryTinting: false,
  showParentEntry: true,
  confirmDelete: true,
  confirmClose: true,
  ambientBackground: true,
  blurOverlays: true,
  keybinds: DEFAULT_KEYBINDS,
  gridSize: "auto",
  gridAutoColumns: GRID_AUTO_COLUMNS_DEFAULT,
  gridGap: GRID_GAP_DEFAULT,
  gridRounded: true,
  gridCentered: true,
  gridShowSize: true,
  gridShowExtension: true,
  gridNameEllipsis: "middle",
  gridNameHideExtension: false,
  menuOpenPwsh: true,
  menuOpenWsl: false,
  menuShowConvert: true,
  thumbnailsEnabled: true,
  thumbnailSize: 224,
  thumbnailQuality: 80,
  thumbnailFormat: "webp",
  thumbnailFolders: true,
  thumbnailVideos: true,
  thumbnailSvgs: false,
  thumbnailCacheMb: 512,
  thumbnailFit: "contain",
  thumbnailAppIcons: true,
  ffmpegPath: "",
};
