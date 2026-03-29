// Central registry for settings sections so navigation and content stay in sync.
import type { ReactNode } from "react";
import { SettingsCacheSection } from "@/components/settings/SettingsCacheSection";
import { SettingsBarsSection } from "@/components/settings/SettingsBarsSection";
import { SettingsFlairSection } from "@/components/settings/SettingsFlairSection";
import { SettingsGeneralSection } from "@/components/settings/SettingsGeneralSection";
import { SettingsGridSection } from "@/components/settings/SettingsGridSection";
import { SettingsKeybindsSection } from "@/components/settings/SettingsKeybindsSection";
import { SettingsMenusSection } from "@/components/settings/SettingsMenusSection";
import { SettingsThumbsSection } from "@/components/settings/SettingsThumbsSection";

export type SettingsSectionId =
  | "settings-general"
  | "settings-bars"
  | "settings-grid"
  | "settings-menus"
  | "settings-flair"
  | "settings-thumbnails"
  | "settings-keybinds"
  | "settings-cache";

export type SettingsSectionRenderContext = {
  open: boolean;
  onCaptureChange: (active: boolean) => void;
  onOpenCacheLocation?: () => Promise<void>;
  onClearCache?: () => Promise<void>;
};

export type SettingsSectionDefinition = {
  id: SettingsSectionId;
  label: string;
  render: (context: SettingsSectionRenderContext) => ReactNode;
};

export const SETTINGS_SECTION_DEFINITIONS: SettingsSectionDefinition[] = [
  {
    id: "settings-general",
    label: "General",
    render: () => <SettingsGeneralSection sectionId="settings-general" />,
  },
  {
    id: "settings-bars",
    label: "Bars",
    render: () => <SettingsBarsSection sectionId="settings-bars" />,
  },
  {
    id: "settings-grid",
    label: "Grid",
    render: () => <SettingsGridSection sectionId="settings-grid" />,
  },
  {
    id: "settings-menus",
    label: "Menus",
    render: () => <SettingsMenusSection sectionId="settings-menus" />,
  },
  {
    id: "settings-flair",
    label: "Flair",
    render: () => <SettingsFlairSection sectionId="settings-flair" />,
  },
  {
    id: "settings-thumbnails",
    label: "Thumbnails",
    render: () => <SettingsThumbsSection sectionId="settings-thumbnails" />,
  },
  {
    id: "settings-keybinds",
    label: "Keybinds",
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
    render: ({ open, onOpenCacheLocation, onClearCache }) => (
      <SettingsCacheSection
        sectionId="settings-cache"
        open={open}
        onOpenCacheLocation={onOpenCacheLocation}
        onClearCache={onClearCache}
      />
    ),
  },
];

export const DEFAULT_SETTINGS_SECTION_ID = SETTINGS_SECTION_DEFINITIONS[0].id;
