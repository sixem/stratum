// Context menu customization settings.
import type { SettingsUpdateHandler } from "./types";

type SettingsMenusSectionProps = {
  sectionId: string;
  menuOpenPwsh: boolean;
  menuOpenWsl: boolean;
  onUpdate: SettingsUpdateHandler;
};

export const SettingsMenusSection = ({
  sectionId,
  menuOpenPwsh,
  menuOpenWsl,
  onUpdate,
}: SettingsMenusSectionProps) => {
  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Menus</div>
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
              onChange={(event) => onUpdate({ menuOpenPwsh: event.currentTarget.checked })}
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
              onChange={(event) => onUpdate({ menuOpenWsl: event.currentTarget.checked })}
            />
            <span>Open in WSL</span>
          </label>
        </div>
      </div>
    </section>
  );
};
