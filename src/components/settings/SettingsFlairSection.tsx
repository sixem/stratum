// Visual flair toggles for the palette, accent, and ambient effects.
import { SettingsPills } from "./SettingsPills";
import { useId } from "react";
import { shallow } from "zustand/shallow";
import { ACCENT_THEMES } from "@/constants/settings";
import { PressButton } from "@/components/primitives/PressButton";
import { useSettingsStore } from "@/modules";
import type { PinShape } from "@/modules";
import { PinShapeIcon } from "@/components/icons/PinShapeIcon";

import { SettingsGroup, SettingsItem, SettingsToggleItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";
import { SettingsTerminalAppearance, TERMINAL_APPEARANCE_ITEMS } from "./SettingsTerminalAppearance";

const APPEARANCE_ITEMS = {
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
  pinShape: {
    label: "Pin shape",
    description: "Choose the indicator used for pinned places in the sidebar.",
    keywords: "sidebar places marker circle square diamond asterisk pill",
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
    description: "Soften the background behind dialogs and menus.",
  },
  showTooltips: {
    label: "Show tooltips",
    description: "Show hints for controls and file items on hover or keyboard focus.",
    keywords: "tool tips disable hide hover hints help popups",
  },
} satisfies Record<string, SettingsItemText>;

export const FLAIR_SETTINGS_ITEMS = { ...APPEARANCE_ITEMS, ...TERMINAL_APPEARANCE_ITEMS };
const appearanceItems = Object.values(APPEARANCE_ITEMS);
const PIN_SHAPES: { id: PinShape; label: string }[] = [
  { id: "circle", label: "Circle" },
  { id: "square", label: "Square" },
  { id: "diamond", label: "Diamond" },
  { id: "asterisk", label: "Asterisk" },
  { id: "pill", label: "Pill" },
];

type SettingsFlairSectionProps = {
  sectionId: string;
  open: boolean;
};

export const SettingsFlairSection = ({ sectionId, open }: SettingsFlairSectionProps) => {
  const darkModeId = useId();
  const darkModeDescriptionId = `${darkModeId}-description`;
  const {
    accentTheme,
    pinShape,
    darkMode,
    categoryTinting,
    ambientBackground,
    blurOverlays,
    showTooltips,
    updateSettings,
  } = useSettingsStore(
    (state) => ({
      accentTheme: state.accentTheme,
      pinShape: state.pinShape,
      darkMode: state.darkMode,
      categoryTinting: state.categoryTinting,
      ambientBackground: state.ambientBackground,
      blurOverlays: state.blurOverlays,
      showTooltips: state.showTooltips,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );

  return (
    <>
      <SettingsGroup id={sectionId} title="Interface" items={appearanceItems}>
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
          <SettingsPills aria-label="Accent color">
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
          </SettingsPills>
        </SettingsItem>
        <SettingsItem item={FLAIR_SETTINGS_ITEMS.pinShape}>
          <SettingsPills aria-label="Pin shape">
            {PIN_SHAPES.map((shape) => (
              <PressButton
                key={shape.id}
                type="button"
                className={`settings-pill${pinShape === shape.id ? " is-active" : ""}`}
                aria-pressed={pinShape === shape.id}
                onClick={() => updateSettings({ pinShape: shape.id })}
              >
                <PinShapeIcon shape={shape.id} className="settings-pin-shape" />
                {shape.label}
              </PressButton>
            ))}
          </SettingsPills>
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
        <SettingsToggleItem item={FLAIR_SETTINGS_ITEMS.showTooltips} checked={showTooltips}
          onChange={(checked) => updateSettings({ showTooltips: checked })} />
      </SettingsGroup>
      <SettingsTerminalAppearance id={`${sectionId}-terminal`} open={open} />
    </>
  );
};
