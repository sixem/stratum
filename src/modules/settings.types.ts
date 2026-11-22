// Shared settings types and enums used across the settings store and UI.
import type { ViewMode } from "@/types";
import type { KeybindMap } from "./keybinds";

export type ThumbnailFormat = "webp" | "jpeg";
export type ThumbnailFit = "cover" | "contain";
export type FixedGridSize = "small" | "normal" | "large";
export type GridSize = FixedGridSize | "auto";
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

export type Settings = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarRecentLimit: number;
  sidebarSectionOrder: SidebarSectionId[];
  sidebarHiddenSections: SidebarSectionId[];
  defaultViewMode: ViewMode;
  showTabNumbers: boolean;
  fixedWidthTabs: boolean;
  tabDropSubfolders: boolean;
  showRecycleBinButton: boolean;
  showDriveToggle: boolean;
  collapseDrivePickerOnBlur: boolean;
  showTopbarFolderChevrons: boolean;
  smoothScroll: boolean;
  smartTabJump: boolean;
  accentTheme: AccentTheme;
  darkMode: boolean;
  categoryTinting: boolean;
  showParentEntry: boolean;
  keepFilterOnNavigation: boolean;
  confirmDelete: boolean;
  confirmClose: boolean;
  warnOnUnsavedWorkspaces: boolean;
  ambientBackground: boolean;
  blurOverlays: boolean;
  keybinds: KeybindMap;
  gridSize: GridSize;
  rememberTabGridSize: boolean;
  gridAutoColumns: number;
  gridGap: number;
  gridRounded: boolean;
  gridCentered: boolean;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  menuOpenPwsh: boolean;
  menuOpenWsl: boolean;
  menuShowConvert: boolean;
  rememberMoveDestinations: boolean;
  recentMoveLimit: number;
  indexedSearchEnabled: boolean;
  thumbnailsEnabled: boolean;
  thumbnailSize: number;
  thumbnailQuality: number;
  thumbnailFormat: ThumbnailFormat;
  thumbnailFolders: boolean;
  thumbnailVideos: boolean;
  thumbnailSvgs: boolean;
  thumbnailCacheMb: number;
  thumbnailFit: ThumbnailFit;
  thumbnailAppIcons: boolean;
  ffmpegPath: string;
};
