// Central registry for settings sections so navigation and content stay in sync.
import type { ReactNode } from "react";
import { KEYBIND_DEFINITIONS } from "@/modules";
import { BACKUP_SETTINGS_ITEMS, SettingsBackupSection } from "./SettingsBackupSection";
import { BARS_SETTINGS_ITEMS, SettingsBarsSection, TOPBAR_SETTINGS_OPTIONS } from "./SettingsBarsSection";
import { CACHE_SETTINGS_ITEMS, SettingsCacheSection } from "./SettingsCacheSection";
import { FLAIR_SETTINGS_ITEMS, SettingsFlairSection } from "./SettingsFlairSection";
import { GENERAL_SETTINGS_ITEMS, SettingsGeneralSection } from "./SettingsGeneralSection";
import { GRID_SETTINGS_ITEMS, SettingsGridSection } from "./SettingsGridSection";
import { INDEXING_SETTINGS_ITEMS, SettingsIndexingSection } from "./SettingsIndexingSection";
import type { SettingsItemText } from "./SettingsItem";
import { KEYBINDS_SETTINGS_ITEMS, SettingsKeybindsSection } from "./SettingsKeybindsSection";
import { MENUS_SETTINGS_ITEMS, SettingsMenusSection } from "./SettingsMenusSection";
import { THUMBS_SETTINGS_ITEMS, SettingsThumbsSection } from "./SettingsThumbsSection";

export type SettingsSectionId =
  | "settings-general"
  | "settings-indexing"
  | "settings-bars"
  | "settings-grid"
  | "settings-menus"
  | "settings-flair"
  | "settings-thumbnails"
  | "settings-keybinds"
  | "settings-cache"
  | "settings-backup";

export type SettingsSectionRenderContext = {
  open: boolean;
  onCaptureChange: (active: boolean) => void;
  onOpenCacheLocation?: () => Promise<void>;
  onClearCache?: () => Promise<void>;
};

export type SettingsSectionDefinition = {
  id: SettingsSectionId;
  label: string;
  items: readonly SettingsItemText[];
  render: (context: SettingsSectionRenderContext) => ReactNode;
};

export const SETTINGS_SECTION_DEFINITIONS: SettingsSectionDefinition[] = [
  {
    id: "settings-general",
    label: "General",
    items: Object.values(GENERAL_SETTINGS_ITEMS),
    render: () => <SettingsGeneralSection sectionId="settings-general" />,
  },
  {
    id: "settings-indexing",
    label: "Indexing",
    items: Object.values(INDEXING_SETTINGS_ITEMS),
    render: ({ open }) => (
      <SettingsIndexingSection sectionId="settings-indexing" open={open} />
    ),
  },
  {
    id: "settings-bars",
    label: "Bars",
    items: [...Object.values(BARS_SETTINGS_ITEMS), ...TOPBAR_SETTINGS_OPTIONS],
    render: () => <SettingsBarsSection sectionId="settings-bars" />,
  },
  {
    id: "settings-grid",
    label: "Grid",
    items: Object.values(GRID_SETTINGS_ITEMS),
    render: () => <SettingsGridSection sectionId="settings-grid" />,
  },
  {
    id: "settings-menus",
    label: "Menus",
    items: Object.values(MENUS_SETTINGS_ITEMS),
    render: () => <SettingsMenusSection sectionId="settings-menus" />,
  },
  {
    id: "settings-flair",
    label: "Flair",
    items: Object.values(FLAIR_SETTINGS_ITEMS),
    render: () => <SettingsFlairSection sectionId="settings-flair" />,
  },
  {
    id: "settings-thumbnails",
    label: "Thumbnails",
    items: Object.values(THUMBS_SETTINGS_ITEMS),
    render: () => <SettingsThumbsSection sectionId="settings-thumbnails" />,
  },
  {
    id: "settings-keybinds",
    label: "Keybinds",
    items: [...Object.values(KEYBINDS_SETTINGS_ITEMS), ...KEYBIND_DEFINITIONS],
    render: ({ open, onCaptureChange }) => (
      <SettingsKeybindsSection
        sectionId="settings-keybinds"
        open={open}
        onCaptureChange={onCaptureChange}
      />
    ),
  },
  {
    id: "settings-cache",
    label: "Cache",
    items: Object.values(CACHE_SETTINGS_ITEMS),
    render: ({ open, onOpenCacheLocation, onClearCache }) => (
      <SettingsCacheSection
        sectionId="settings-cache"
        open={open}
        onOpenCacheLocation={onOpenCacheLocation}
        onClearCache={onClearCache}
      />
    ),
  },
  {
    id: "settings-backup",
    label: "Backup",
    items: Object.values(BACKUP_SETTINGS_ITEMS),
    render: () => <SettingsBackupSection sectionId="settings-backup" />,
  },
];

export const DEFAULT_SETTINGS_SECTION_ID = SETTINGS_SECTION_DEFINITIONS[0].id;

export const searchSettingsSections = (query: string, autoGrid: boolean, moveHistoryEnabled: boolean) => {
  const terms = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (terms.length === 0) return null;

  return SETTINGS_SECTION_DEFINITIONS.flatMap((section) => {
    const items = section.items.filter((item) => {
      if (item.requiresAutoGrid !== undefined && item.requiresAutoGrid !== autoGrid) return false;
      if (item.requiresMoveHistory && !moveHistoryEnabled) return false;
      const searchable = [section.label, item.label, item.description, item.keywords].join(" ").toLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
    return items.length > 0 ? [{ section, matches: new Set(items) }] : [];
  });
};
