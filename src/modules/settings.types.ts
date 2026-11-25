// Shared settings types and enums used across the settings store and UI.
import type { SortState, ViewMode } from "@/types";
import type { ContextMenuAction } from "@/lib/contextMenuVisibility";
import type { KeybindMap } from "./keybinds";

export type ThumbnailFormat = "webp" | "jpeg";
export type ThumbnailFit = "cover" | "contain";
export type FixedGridSize = "small" | "normal" | "large";
export type GridSize = FixedGridSize | "auto";
export type GridNameEllipsis = "end" | "middle";
export type ListDensity = "compact" | "comfortable";
export type AccentTheme =
  | "red"
  | "purple"
  | "green"
  | "yellow"
  | "orange"
  | "teal"
  | "white";
export type SidebarSectionId = "places" | "recent" | "tips";
export type StartupMode = "resume" | "workspace" | "start";

export type Settings = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarRecentLimit: number;
  sidebarSectionOrder: SidebarSectionId[];
  sidebarHiddenSections: SidebarSectionId[];
  defaultViewMode: ViewMode | "last";
  lastUsedViewMode: ViewMode | null;
  startupMode: StartupMode;
  startupWorkspaceId: string | null;
  newTabSort: SortState | null;
  rememberRecentLocations: boolean;
  showTabNumbers: boolean;
  fixedWidthTabs: boolean;
  animateTabChanges: boolean;
  tabDropSubfolders: boolean;
  showRecycleBinButton: boolean;
  showDriveToggle: boolean;
  collapseDrivePickerOnBlur: boolean;
  showTopbarFolderChevrons: boolean;
  showWorkProgressFill: boolean;
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
  listDensity: ListDensity;
  listShowSize: boolean;
  listShowModified: boolean;
  menuUseWindowsForItems: boolean;
  menuOpenPwsh: boolean;
  menuOpenWsl: boolean;
  menuShowConvert: boolean;
  menuPaneTransfers: boolean;
  menuSelectionActions: boolean;
  menuOpenBackgroundTab: boolean;
  hiddenContextMenuActions: ContextMenuAction[];
  rememberMoveDestinations: boolean;
  recentMoveLimit: number;
  indexedSearchEnabled: boolean;
  excludedIndexedDrives: string[];
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
  /** Applies to audio and video. Keep the stored key for existing profiles and backups. */
  videoAutoplay: boolean;
  galleryAudio: boolean;
  ffmpegPath: string;
};
