// Context menu customization settings.
import { shallow } from "zustand/shallow";
import { useSettingsStore } from "@/modules";

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
      <div className="settings-item">
        <div>
          <div className="settings-label">Conversion actions</div>
          <div className="settings-desc">
            Show convert and quick-convert actions in file context menus.
          </div>
        </div>
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
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Background actions</div>
          <div className="settings-desc">
            Show quick shell launchers when right-clicking the view background.
          </div>
        </div>
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
      </div>
    </section>
  );
};
