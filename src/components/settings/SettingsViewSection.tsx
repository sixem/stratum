// View defaults and navigation behavior controls.
import type { ViewMode } from "@/types";
import type { SettingsUpdateHandler } from "./types";

type SettingsViewSectionProps = {
  sectionId: string;
  defaultViewMode: ViewMode;
  smoothScroll: boolean;
  gridCentered: boolean;
  compactMode: boolean;
  showParentEntry: boolean;
  confirmDelete: boolean;
  onUpdate: SettingsUpdateHandler;
};

export function SettingsViewSection({
  sectionId,
  defaultViewMode,
  smoothScroll,
  gridCentered,
  compactMode,
  showParentEntry,
  confirmDelete,
  onUpdate,
}: SettingsViewSectionProps) {
  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">View</div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Default view</div>
          <div className="settings-desc">Used for new tabs and new sessions.</div>
        </div>
        <div className="settings-pills" role="group" aria-label="Default view">
          <button
            type="button"
            className={`settings-pill${defaultViewMode === "thumbs" ? " is-active" : ""}`}
            onClick={() => onUpdate({ defaultViewMode: "thumbs" })}
          >
            Grid
          </button>
          <button
            type="button"
            className={`settings-pill${defaultViewMode === "list" ? " is-active" : ""}`}
            onClick={() => onUpdate({ defaultViewMode: "list" })}
          >
            List
          </button>
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
            onChange={(event) => onUpdate({ smoothScroll: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Center grid items</div>
          <div className="settings-desc">Center the grid within the viewport.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={gridCentered}
            onChange={(event) => onUpdate({ gridCentered: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Compact mode</div>
          <div className="settings-desc">
            Edge-to-edge layout with a flush sidebar and a simplified content frame.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={compactMode}
            onChange={(event) => onUpdate({ compactMode: event.currentTarget.checked })}
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
            onChange={(event) => onUpdate({ showParentEntry: event.currentTarget.checked })}
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
            onChange={(event) => onUpdate({ confirmDelete: event.currentTarget.checked })}
          />
          <span />
        </label>
      </div>
    </section>
  );
}
