// Grid-specific appearance and content controls.
import {
  GRID_AUTO_COLUMNS_MAX,
  GRID_AUTO_COLUMNS_MIN,
  GRID_GAP_MAX,
  GRID_GAP_MIN,
} from "@/modules";
import type { GridNameEllipsis, GridSize } from "@/modules";
import { PressButton } from "@/components/primitives/PressButton";
import { useDeferredRange } from "./useDeferredRange";
import type { SettingsUpdateHandler } from "./types";

type SettingsGridSectionProps = {
  sectionId: string;
  gridSize: GridSize;
  gridAutoColumns: number;
  gridGap: number;
  gridRounded: boolean;
  gridShowSize: boolean;
  gridShowExtension: boolean;
  gridNameEllipsis: GridNameEllipsis;
  gridNameHideExtension: boolean;
  onUpdate: SettingsUpdateHandler;
};

const GRID_SIZES: { id: GridSize; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "normal", label: "Normal" },
  { id: "large", label: "Large" },
  { id: "auto", label: "Auto" },
];
const GRID_NAME_ELLIPSIS: { id: GridNameEllipsis; label: string }[] = [
  { id: "end", label: "End" },
  { id: "middle", label: "Middle" },
];

export const SettingsGridSection = ({
  sectionId,
  gridSize,
  gridAutoColumns,
  gridGap,
  gridRounded,
  gridShowSize,
  gridShowExtension,
  gridNameEllipsis,
  gridNameHideExtension,
  onUpdate,
}: SettingsGridSectionProps) => {
  const autoColumnsRange = useDeferredRange({
    value: gridAutoColumns,
    onCommit: (value) => onUpdate({ gridAutoColumns: value }),
  });
  const gridGapRange = useDeferredRange({
    value: gridGap,
    onCommit: (value) => onUpdate({ gridGap: value }),
  });

  return (
    <section className="settings-section" id={sectionId}>
      <div className="settings-section-title">Grid</div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Grid size</div>
          <div className="settings-desc">
            Choose a preset size or let the grid auto-fit by column count.
          </div>
        </div>
        <div className="settings-pills" role="group" aria-label="Grid size">
          {GRID_SIZES.map((size) => (
            <PressButton
              key={size.id}
              type="button"
              className={`settings-pill${gridSize === size.id ? " is-active" : ""}`}
              onClick={() => onUpdate({ gridSize: size.id })}
            >
              {size.label}
            </PressButton>
          ))}
        </div>
      </div>
      {gridSize === "auto" ? (
        <div className="settings-item">
          <div>
            <div className="settings-label">Auto columns</div>
            <div className="settings-desc">
              Pick how many columns the grid should fit across the view.
            </div>
          </div>
          <div className="settings-range">
            <input
              type="range"
              min={GRID_AUTO_COLUMNS_MIN}
              max={GRID_AUTO_COLUMNS_MAX}
              step={1}
              {...autoColumnsRange.bind}
            />
            <span className="settings-value">{autoColumnsRange.draft}</span>
          </div>
        </div>
      ) : null}
      <div className="settings-item">
        <div>
          <div className="settings-label">Grid gap</div>
          <div className="settings-desc">Adjust the spacing between grid cards.</div>
        </div>
        <div className="settings-range">
          <input
            type="range"
            min={GRID_GAP_MIN}
            max={GRID_GAP_MAX}
            step={1}
            {...gridGapRange.bind}
          />
          <span className="settings-value">{gridGapRange.draft}px</span>
        </div>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Grid corners</div>
          <div className="settings-desc">Rounded cards or straight edges.</div>
        </div>
        <div className="settings-pills" role="group" aria-label="Grid corners">
          <PressButton
            type="button"
            className={`settings-pill${gridRounded ? " is-active" : ""}`}
            onClick={() => onUpdate({ gridRounded: true })}
          >
            Rounded
          </PressButton>
          <PressButton
            type="button"
            className={`settings-pill${gridRounded ? "" : " is-active"}`}
            onClick={() => onUpdate({ gridRounded: false })}
          >
            Straight
          </PressButton>
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
            <PressButton
              key={mode.id}
              type="button"
              className={`settings-pill${gridNameEllipsis === mode.id ? " is-active" : ""}`}
              onClick={() => onUpdate({ gridNameEllipsis: mode.id })}
            >
              {mode.label}
            </PressButton>
          ))}
        </div>
      </div>
    </section>
  );
};
