// Grid-specific appearance and content controls.
import type { GridNameEllipsis, GridSize } from "@/modules";
import type { SettingsUpdateHandler } from "./types";

type SettingsGridSectionProps = {
  sectionId: string;
  gridSize: GridSize;
  gridRounded: boolean;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
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

export function SettingsGridSection({
  sectionId,
  gridSize,
  gridRounded,
  gridShowSize,
  gridShowExtension,
  gridNameEllipsis,
  gridNameHideExtension,
  onUpdate,
}: SettingsGridSectionProps) {
  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Grid</div>
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
    </section>
  );
}
