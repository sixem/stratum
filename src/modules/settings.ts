// Public settings exports to keep module imports stable.
export { useSettingsStore } from "./settings.store";
export {
  DEFAULT_SIDEBAR_SECTION_ORDER,
  DEFAULT_SIDEBAR_HIDDEN_SECTIONS,
  SIDEBAR_SECTION_DEFINITIONS,
} from "./settings.defaults";
export {
  normalizeSidebarHiddenSections,
  normalizeSidebarSectionOrder,
} from "./settings.normalize";
export type {
  AccentTheme,
  GridNameEllipsis,
  GridSize,
  Settings,
  SidebarSectionId,
  ThumbnailFit,
} from "./settings.types";
