// View defaults and grid presentation controls.
import type { ViewMode } from "@/types";
import type { GridNameEllipsis, GridSize } from "@/modules";
import type { SettingsUpdateHandler } from "./types";

type SettingsViewSectionProps = {
  sectionId: string;
  defaultViewMode: ViewMode;
  gridSize: GridSize;
  gridRounded: boolean;
  gridCentered: boolean;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  showParentEntry: boolean;
  onUpdate: SettingsUpdateHandler;
};

const GRID_SIZES: { id: GridSize; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "large", label: "Large" },
];
const GRID_NAME_ELLIPSIS: { id: GridNameEllipsis; label: string }[] = [
  { id: "end", label: "End" },
  { id: "middle", label: "Middle" },
];

export function SettingsViewSection({
  sectionId,
  defaultViewMode,
  gridSize,
  gridRounded,
  gridCentered,
  gridShowSize,
  gridShowExtension,
  gridNameEllipsis,
  gridNameHideExtension,
  showParentEntry,
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
          <div className="settings-label">Grid size</div>
          <div className="settings-desc">Adjust the grid density in thumbnail view.</div>
        </div>
        <div className="settings-pills" role="group" aria-label="Grid size">
          {GRID_SIZES.map((size) => (
            <button
              key={size.id}
              type="button"
              className={`settings-pill${gridSize === size.id ? " is-active" : ""}`}
              onClick={() => onUpdate({ gridSize: size.id })}
            >
              {size.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Grid corners</div>
          <div className="settings-desc">Rounded cards or straight edges.</div>
        </div>
        <div className="settings-pills" role="group" aria-label="Grid corners">
          <button
            type="button"
            className={`settings-pill${gridRounded ? " is-active" : ""}`}
            onClick={() => onUpdate({ gridRounded: true })}
          >
            Rounded
          </button>
          <button
            type="button"
            className={`settings-pill${gridRounded ? "" : " is-active"}`}
            onClick={() => onUpdate({ gridRounded: false })}
          >
            Straight
          </button>
        </div>
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
          <div className="settings-label">Grid details</div>
          <div className="settings-desc">Name is always shown in grid cards.</div>
        </div>
        <div className="settings-pills" role="group" aria-label="Grid details">
          <label
            className={`settings-pill settings-pill-check${gridShowSize ? " is-active" : ""}`}
          >
            <input
              type="checkbox"
              checked={gridShowSize}
              onChange={(event) => onUpdate({ gridShowSize: event.currentTarget.checked })}
            />
            <span>File size</span>
          </label>
          <label
            className={`settings-pill settings-pill-check${
              gridShowExtension ? " is-active" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={gridShowExtension}
              onChange={(event) =>
                onUpdate({ gridShowExtension: event.currentTarget.checked })
              }
            />
            <span>Extension</span>
          </label>
        </div>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Hide extension in grid names</div>
          <div className="settings-desc">Keep the base filename in the title line.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={gridNameHideExtension}
            onChange={(event) =>
              onUpdate({ gridNameHideExtension: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Grid name truncation</div>
          <div className="settings-desc">
            Choose how long names are shortened. Middle keeps the ending visible.
          </div>
        </div>
        <div className="settings-pills" role="group" aria-label="Grid name truncation">
          {GRID_NAME_ELLIPSIS.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`settings-pill${gridNameEllipsis === mode.id ? " is-active" : ""}`}
              onClick={() => onUpdate({ gridNameEllipsis: mode.id })}
            >
              {mode.label}
            </button>
          ))}
        </div>
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
    </section>
  );
}
