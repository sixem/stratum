// Header and navigation bar presentation controls.
import type { SettingsUpdateHandler } from "./types";

type SettingsBarsSectionProps = {
  sectionId: string;
  showTabNumbers: boolean;
  fixedWidthTabs: boolean;
  onUpdate: SettingsUpdateHandler;
};

export function SettingsBarsSection({
  sectionId,
  showTabNumbers,
  fixedWidthTabs,
  onUpdate,
}: SettingsBarsSectionProps) {
  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Bars</div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Tab numbers</div>
          <div className="settings-desc">
            Show a small index number beside each tab title.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={showTabNumbers}
            onChange={(event) =>
              onUpdate({ showTabNumbers: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Fixed-width tabs</div>
          <div className="settings-desc">
            Keep every tab the same width instead of sizing to the title.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={fixedWidthTabs}
            onChange={(event) =>
              onUpdate({ fixedWidthTabs: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </div>
    </section>
  );
}
