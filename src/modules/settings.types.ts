// Shared settings types and enums used across the settings store and UI.
import type { ViewMode } from "@/types";
import type { KeybindMap } from "./keybinds";

export type ThumbnailFormat = "webp" | "jpeg";
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

export type Settings = {
  sidebarOpen: boolean;
  sidebarRecentLimit: number;
  sidebarSectionOrder: SidebarSectionId[];
  sidebarHiddenSections: SidebarSectionId[];
  defaultViewMode: ViewMode;
  showTabNumbers: boolean;
  fixedWidthTabs: boolean;
  smoothScroll: boolean;
  smartTabJump: boolean;
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
