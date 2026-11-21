// Context menu customization settings.
import { shallow } from "zustand/shallow";
import { useSettingsStore } from "@/modules";

import { SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const MENUS_SETTINGS_ITEMS = {
  conversionActions: {
    label: "Conversion actions",
    description: "Show convert and quick-convert actions in file context menus.",
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
  const { menuOpenPwsh, menuOpenWsl, menuShowConvert, updateSettings } = useSettingsStore(
    (state) => ({
      menuOpenPwsh: state.menuOpenPwsh,
      menuOpenWsl: state.menuOpenWsl,
      menuShowConvert: state.menuShowConvert,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );

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
