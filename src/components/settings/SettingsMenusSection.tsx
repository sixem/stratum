// Context menu customization settings.
import { shallow } from "zustand/shallow";
import { RECENT_MOVE_LIMIT_MAX, RECENT_MOVE_LIMIT_MIN } from "@/constants";
import { useSettingsStore } from "@/modules";

import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";
import { useDeferredRange } from "./useDeferredRange";

export const MENUS_SETTINGS_ITEMS = {
  conversionActions: {
    label: "Conversion actions",
    description: "Show convert and quick-convert actions in file context menus.",
  },
  rememberMoveDestinations: {
    label: "Remember move destinations",
    description: "Show recent destinations in the Move to menu. Tabs and panes in the same workspace share the list.",
    keywords: "recent moves history limit maximum",
  },
  recentMoveLimit: {
    label: "Recent move limit",
    description: "Keep up to this many destinations per workspace. Older destinations are removed first.",
    keywords: "Move to history",
    requiresMoveHistory: true,
  },
  backgroundActions: {
    label: "Background actions",
    description: "Show quick shell launchers when right-clicking the view background.",
    keywords: "PowerShell WSL",
  },
} satisfies Record<string, SettingsItemText>;

type SettingsMenusSectionProps = {
  sectionId: string;
};

export const SettingsMenusSection = ({ sectionId }: SettingsMenusSectionProps) => {
  const { menuOpenPwsh, menuOpenWsl, menuShowConvert, rememberMoveDestinations, recentMoveLimit, updateSettings } = useSettingsStore(
    (state) => ({
      menuOpenPwsh: state.menuOpenPwsh,
      menuOpenWsl: state.menuOpenWsl,
      menuShowConvert: state.menuShowConvert,
      rememberMoveDestinations: state.rememberMoveDestinations,
      recentMoveLimit: state.recentMoveLimit,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const limit = useDeferredRange({
    value: recentMoveLimit,
    onCommit: (value) => updateSettings({ recentMoveLimit: value }),
  });

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Menus</div>
      <SettingsItem item={MENUS_SETTINGS_ITEMS.conversionActions}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={menuShowConvert}
            onChange={(event) =>
              updateSettings({ menuShowConvert: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={MENUS_SETTINGS_ITEMS.rememberMoveDestinations}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={MENUS_SETTINGS_ITEMS.rememberMoveDestinations.label}
            checked={rememberMoveDestinations}
            onChange={(event) => updateSettings({ rememberMoveDestinations: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      {rememberMoveDestinations && (
        <SettingsItem item={MENUS_SETTINGS_ITEMS.recentMoveLimit}>
          <div className="settings-range">
            <input
              type="range"
              className="ui-range"
              aria-label={MENUS_SETTINGS_ITEMS.recentMoveLimit.label}
              min={RECENT_MOVE_LIMIT_MIN}
              max={RECENT_MOVE_LIMIT_MAX}
              step={1}
              {...limit.bind}
            />
            <span className="settings-value tnum">{limit.draft}</span>
          </div>
        </SettingsItem>
      )}
      <SettingsItem item={MENUS_SETTINGS_ITEMS.backgroundActions}>
        <div className="settings-pills" role="group" aria-label="Background menu">
          <label
            className={`settings-pill settings-pill-check${
              menuOpenPwsh ? " is-active" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={menuOpenPwsh}
              onChange={(event) =>
                updateSettings({ menuOpenPwsh: event.currentTarget.checked })
              }
            />
            <span>Open in PowerShell</span>
          </label>
          <label
            className={`settings-pill settings-pill-check${
              menuOpenWsl ? " is-active" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={menuOpenWsl}
              onChange={(event) =>
                updateSettings({ menuOpenWsl: event.currentTarget.checked })
              }
            />
            <span>Open in WSL</span>
          </label>
        </div>
      </SettingsItem>
    </section>
  );
};
