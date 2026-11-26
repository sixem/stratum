// Central registry for settings sections so navigation and content stay in sync.
import type { ReactNode } from "react";
import { KEYBIND_DEFINITIONS } from "@/modules";
import { BACKUP_SETTINGS_ITEMS, SettingsBackupSection } from "./SettingsBackupSection";
import { BARS_SETTINGS_ITEMS, SettingsBarsSection } from "./SettingsBarsSection";
import { CACHE_SETTINGS_ITEMS, SettingsCacheSection } from "./SettingsCacheSection";
import { FILE_VIEW_DEFAULTS_ITEMS, SettingsFileViewDefaults } from "./SettingsFileViewDefaults";
import { FLAIR_SETTINGS_ITEMS, SettingsFlairSection } from "./SettingsFlairSection";
import { GENERAL_SETTINGS_ITEMS, SettingsGeneralSection } from "./SettingsGeneralSection";
import { GRID_SETTINGS_ITEMS, SettingsGridSection } from "./SettingsGridSection";
import { LIST_SETTINGS_ITEMS, SettingsListSection } from "./SettingsListSection";
import { INDEXING_SETTINGS_ITEMS, SettingsIndexingSection } from "./SettingsIndexingSection";
import type { SettingsItemText } from "./SettingsItem";
import { KEYBINDS_SETTINGS_ITEMS, SettingsKeybindsSection } from "./SettingsKeybindsSection";
import { MEDIA_SETTINGS_ITEMS, SettingsMediaSection } from "./SettingsMediaSection";
import { MENUS_SETTINGS_ITEMS, SettingsMenusSection } from "./SettingsMenusSection";
import { MENU_VISIBILITY_SETTINGS_ITEMS } from "./SettingsMenuVisibility";
import { THUMBS_SETTINGS_ITEMS, SettingsThumbsSection } from "./SettingsThumbsSection";
import { REMOTE_SETTINGS_ITEMS, SettingsRemotesSection } from "./SettingsRemotesSection";
import { UPDATE_SETTINGS_ITEMS, SettingsUpdatesSection } from "./SettingsUpdatesSection";

export type SettingsSectionId =
  | "settings-general"
  | "settings-indexing"
  | "settings-bars"
  | "settings-file-views"
  | "settings-menus"
  | "settings-flair"
  | "settings-thumbnails"
  | "settings-media"
  | "settings-keybinds"
  | "settings-cache"
  | "settings-backup"
  | "settings-remotes"
  | "settings-updates";

export type SettingsSectionRenderContext = {
  open: boolean;
  onCaptureChange: (active: boolean) => void;
  onOpenCacheLocation?: () => Promise<void>;
  onClearCache?: () => Promise<void>;
};

export type SettingsSectionDefinition = {
  id: SettingsSectionId;
  label: string;
  keywords?: string;
  items: readonly SettingsItemText[];
  render: (context: SettingsSectionRenderContext) => ReactNode;
};

export const SETTINGS_SECTION_DEFINITIONS: SettingsSectionDefinition[] = [
  {
    id: "settings-general",
    label: "General",
    items: Object.values(GENERAL_SETTINGS_ITEMS),
    render: ({ open }) => <SettingsGeneralSection sectionId="settings-general" open={open} />,
  },
  {
    id: "settings-flair",
    label: "Appearance",
    keywords: "flair",
    items: Object.values(FLAIR_SETTINGS_ITEMS),
    render: ({ open }) => <SettingsFlairSection sectionId="settings-flair" open={open} />,
  },
  {
    id: "settings-bars",
    label: "Tabs & layout",
    keywords: "bars",
    items: BARS_SETTINGS_ITEMS,
    render: () => <SettingsBarsSection sectionId="settings-bars" />,
  },
  {
    id: "settings-file-views",
    label: "File views",
    items: [...Object.values(FILE_VIEW_DEFAULTS_ITEMS), ...Object.values(GRID_SETTINGS_ITEMS), ...Object.values(LIST_SETTINGS_ITEMS)],
    render: () => (
      <>
        <SettingsFileViewDefaults sectionId="settings-file-views" />
        <SettingsGridSection sectionId="settings-grid" />
        <SettingsListSection sectionId="settings-list" />
      </>
    ),
  },
  {
    id: "settings-menus",
    label: "Context menus",
    items: [...Object.values(MENUS_SETTINGS_ITEMS), ...MENU_VISIBILITY_SETTINGS_ITEMS],
    render: () => <SettingsMenusSection sectionId="settings-menus" />,
  },
  {
    id: "settings-keybinds",
    label: "Shortcuts",
    keywords: "keybinds keybindings keyboard controls",
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
    id: "settings-indexing",
    label: "Indexed search",
    keywords: "indexing",
    items: Object.values(INDEXING_SETTINGS_ITEMS),
    render: ({ open }) => (
      <SettingsIndexingSection sectionId="settings-indexing" open={open} />
    ),
  },
  {
    id: "settings-media",
    label: "Gallery & media",
    items: Object.values(MEDIA_SETTINGS_ITEMS),
    render: () => <SettingsMediaSection sectionId="settings-media" />,
  },
  {
    id: "settings-thumbnails",
    label: "Thumbnails",
    items: Object.values(THUMBS_SETTINGS_ITEMS),
    render: () => <SettingsThumbsSection sectionId="settings-thumbnails" />,
  },
  {
    id: "settings-cache",
    label: "Thumbnail cache",
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
    id: "settings-remotes",
    label: "Remote folders",
    keywords: "ssh sftp hosts servers",
    items: Object.values(REMOTE_SETTINGS_ITEMS),
    render: () => <SettingsRemotesSection />,
  },
  {
    id: "settings-updates",
    label: "Updates",
    items: Object.values(UPDATE_SETTINGS_ITEMS),
    render: () => <SettingsUpdatesSection />,
  },
  {
    id: "settings-backup",
    label: "Backup & restore",
    items: Object.values(BACKUP_SETTINGS_ITEMS),
    render: () => <SettingsBackupSection sectionId="settings-backup" />,
  },
];

export const DEFAULT_SETTINGS_SECTION_ID = SETTINGS_SECTION_DEFINITIONS[0].id;

export const searchSettingsSections = (query: string, autoGrid: boolean, moveHistoryEnabled: boolean) => {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (terms.length === 0) return null;

  return SETTINGS_SECTION_DEFINITIONS.flatMap((section) => {
    const items = section.items.filter((item) => {
      if (item.requiresAutoGrid !== undefined && item.requiresAutoGrid !== autoGrid) return false;
      if (item.requiresMoveHistory && !moveHistoryEnabled) return false;
      const searchable = [section.label, section.keywords, item.label, item.description, item.keywords].join(" ").toLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
    return items.length > 0 ? [{ section, matches: new Set(items) }] : [];
  });
};
