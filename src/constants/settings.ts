// Settings defaults and bounds shared by modules/UI.
import type { AccentTheme } from "@/modules/settings.types";

export const SIDEBAR_RECENT_LIMIT_MIN = 1;
export const SIDEBAR_RECENT_LIMIT_MAX = 20;
export const RECENT_MOVE_LIMIT_MIN = 1;
export const RECENT_MOVE_LIMIT_MAX = 20;
export const SIDEBAR_WIDTH_DEFAULT = 250;
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 400;

export const GRID_AUTO_COLUMNS_MIN = 3;
export const GRID_AUTO_COLUMNS_MAX = 10;
export const GRID_AUTO_COLUMNS_DEFAULT = 5;
export const GRID_GAP_MIN = 2;
export const GRID_GAP_MAX = 24;
export const GRID_GAP_DEFAULT = 8;

export const LIST_COLUMN_OPTIONS = [
  { key: "listShowSize", label: "Size" },
  { key: "listShowModified", label: "Modified" },
] as const;

export const ACCENT_THEMES = [
  { id: "red", label: "Red" },
  { id: "purple", label: "Purple" },
  { id: "green", label: "Green" },
  { id: "yellow", label: "Yellow" },
  { id: "orange", label: "Orange" },
  { id: "teal", label: "Teal" },
  { id: "white", label: "White" },
] as const satisfies readonly { id: AccentTheme; label: string }[];

export const SETTINGS_STORAGE_KEY = "stratum.settings";
export const SETTINGS_STORAGE_VERSION = 19;
export const BOTTOM_PANE_STORAGE_KEY = "stratum.bottom-pane";
export const PREVIEW_STRIP_OPEN_KEY = "stratum.preview.strip-open";
export const PREVIEW_VOLUME_KEY = "stratum.preview.volume";
