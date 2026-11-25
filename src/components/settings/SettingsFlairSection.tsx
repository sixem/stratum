// Visual flair toggles for the palette, accent, and ambient effects.
import { useId } from "react";
import { shallow } from "zustand/shallow";
import { ACCENT_THEMES } from "@/constants/settings";
import { PressButton } from "@/components/primitives/PressButton";
import { DropdownSelect } from "@/components/primitives/DropdownSelect";
import { useSettingsStore } from "@/modules";
import { coerceTerminalTheme, TERMINAL_THEME_OPTIONS } from "@/modules/terminalThemes";

import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const FLAIR_SETTINGS_ITEMS = {
  darkMode: {
    label: "Dark Mode",
    description: "Use a darker, neutral palette.",
    keywords: "theme appearance",
  },
  accentColor: {
    label: "Accent color",
    description: "Tint highlights and accents.",
    keywords: "theme appearance",
  },
  terminalTheme: {
    label: "Terminal theme",
    description: "Choose a color palette for PowerShell tabs.",
    keywords: "shell console appearance",
  },
  categoryTints: {
    label: "Category tints",
    description: "Subtle color cues for file types in grid and list views.",
  },
  ambientBackground: {
    label: "Ambient background",
    description: "A slow-moving backdrop in the main file pane.",
  },
  blurOverlays: {
    label: "Blur overlays",
    description: "Backdrop blur for dialogs, menus, and tooltips.",
  },
} satisfies Record<string, SettingsItemText>;

const terminalThemeGroups = [{ id: "terminal-themes", options: [...TERMINAL_THEME_OPTIONS] }];

type SettingsFlairSectionProps = {
  sectionId: string;
};

export const SettingsFlairSection = ({ sectionId }: SettingsFlairSectionProps) => {
  const darkModeId = useId();
  const darkModeDescriptionId = `${darkModeId}-description`;
  const {
    accentTheme,
    terminalTheme,
    darkMode,
    categoryTinting,
    ambientBackground,
    blurOverlays,
    updateSettings,
  } = useSettingsStore(
    (state) => ({
      accentTheme: state.accentTheme,
      terminalTheme: state.terminalTheme,
      darkMode: state.darkMode,
      categoryTinting: state.categoryTinting,
      ambientBackground: state.ambientBackground,
      blurOverlays: state.blurOverlays,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Flair</div>
      <SettingsItem
        item={FLAIR_SETTINGS_ITEMS.darkMode}
        labelFor={darkModeId}
        descriptionId={darkModeDescriptionId}
      >
        <label className="settings-toggle">
          <input
            type="checkbox"
            id={darkModeId}
            aria-describedby={darkModeDescriptionId}
            checked={darkMode}
            onChange={(event) => updateSettings({ darkMode: event.currentTarget.checked })}
          />
          <span aria-hidden="true" />
        </label>
      </SettingsItem>
      <SettingsItem item={FLAIR_SETTINGS_ITEMS.accentColor}>
        <div className="settings-pills" role="group" aria-label="Accent color">
          {ACCENT_THEMES.map((theme) => (
            <PressButton
              key={theme.id}
              type="button"
              data-accent={theme.id}
              className={`settings-pill${accentTheme === theme.id ? " is-active" : ""}`}
              aria-pressed={accentTheme === theme.id}
              onClick={() => updateSettings({ accentTheme: theme.id })}
            >
              <span className="settings-swatch" aria-hidden="true" />
              {theme.label}
            </PressButton>
          ))}
        </div>
      </SettingsItem>
      <SettingsItem item={FLAIR_SETTINGS_ITEMS.terminalTheme}>
        <DropdownSelect
          value={terminalTheme}
          ariaLabel={FLAIR_SETTINGS_ITEMS.terminalTheme.label}
          groups={terminalThemeGroups}
          onChange={(value) => updateSettings({ terminalTheme: coerceTerminalTheme(value) })}
        />
      </SettingsItem>
      <SettingsItem item={FLAIR_SETTINGS_ITEMS.categoryTints}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={categoryTinting}
            onChange={(event) =>
              updateSettings({ categoryTinting: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={FLAIR_SETTINGS_ITEMS.ambientBackground}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={ambientBackground}
            onChange={(event) =>
              updateSettings({ ambientBackground: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={FLAIR_SETTINGS_ITEMS.blurOverlays}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={blurOverlays}
            onChange={(event) => updateSettings({ blurOverlays: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
    </section>
  );
};
