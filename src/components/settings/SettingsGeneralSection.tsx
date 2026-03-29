// General settings and view defaults that shape navigation and layout.
import { shallow } from "zustand/shallow";
import { PressButton } from "@/components/primitives/PressButton";
import { useSettingsStore } from "@/modules";

type SettingsGeneralSectionProps = {
  sectionId: string;
};

export const SettingsGeneralSection = ({ sectionId }: SettingsGeneralSectionProps) => {
  const {
    defaultViewMode,
    smoothScroll,
    gridCentered,
    showParentEntry,
    confirmDelete,
    confirmClose,
    updateSettings,
  } = useSettingsStore(
    (state) => ({
      defaultViewMode: state.defaultViewMode,
      smoothScroll: state.smoothScroll,
      gridCentered: state.gridCentered,
      showParentEntry: state.showParentEntry,
      confirmDelete: state.confirmDelete,
      confirmClose: state.confirmClose,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">General</div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Default view</div>
          <div className="settings-desc">Used for new tabs and new sessions.</div>
        </div>
        <div className="settings-pills" role="group" aria-label="Default view">
          <PressButton
            type="button"
            className={`settings-pill${defaultViewMode === "thumbs" ? " is-active" : ""}`}
            onClick={() => updateSettings({ defaultViewMode: "thumbs" })}
          >
            Grid
          </PressButton>
          <PressButton
            type="button"
            className={`settings-pill${defaultViewMode === "list" ? " is-active" : ""}`}
            onClick={() => updateSettings({ defaultViewMode: "list" })}
          >
            List
          </PressButton>
        </div>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Smooth scrolling</div>
          <div className="settings-desc">
            Keep the original smooth wheel scroll instead of snapping by row.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={smoothScroll}
            onChange={(event) => updateSettings({ smoothScroll: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Center grid items</div>
          <div className="settings-desc">Center the grid within the viewport. Will not have an effect with autosized grids.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={gridCentered}
            onChange={(event) => updateSettings({ gridCentered: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Parent directory entry</div>
          <div className="settings-desc">Show a pseudo entry for moving up one level.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={showParentEntry}
            onChange={(event) => updateSettings({ showParentEntry: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Confirm deletes</div>
          <div className="settings-desc">
            Ask before sending items to the trash.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={confirmDelete}
            onChange={(event) => updateSettings({ confirmDelete: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Confirm on close</div>
          <div className="settings-desc">
            Show a confirmation dialog before closing the app window.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={confirmClose}
            onChange={(event) => updateSettings({ confirmClose: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
    </section>
  );
};
