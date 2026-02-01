// Grid-specific appearance and content controls.
import { useEffect, useState } from "react";
import {
  GRID_AUTO_COLUMNS_MAX,
  GRID_AUTO_COLUMNS_MIN,
  GRID_GAP_MAX,
  GRID_GAP_MIN,
} from "@/modules";
import type { GridNameEllipsis, GridSize } from "@/modules";
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
  const [autoColumnsDraft, setAutoColumnsDraft] = useState(gridAutoColumns);
  const [gridGapDraft, setGridGapDraft] = useState(gridGap);

  useEffect(() => {
    setAutoColumnsDraft(gridAutoColumns);
  }, [gridAutoColumns]);
  useEffect(() => {
    setGridGapDraft(gridGap);
  }, [gridGap]);

  const commitAutoColumns = () => {
    if (autoColumnsDraft === gridAutoColumns) return;
    onUpdate({ gridAutoColumns: autoColumnsDraft });
  };
  const commitGridGap = () => {
    if (gridGapDraft === gridGap) return;
    onUpdate({ gridGap: gridGapDraft });
  };

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
              value={autoColumnsDraft}
              onChange={(event) =>
                setAutoColumnsDraft(Number(event.currentTarget.value))
              }
              onPointerUp={commitAutoColumns}
              onKeyUp={(event) => {
                if (event.key === "Enter") {
                  commitAutoColumns();
                }
              }}
              onBlur={commitAutoColumns}
            />
            <span className="settings-value">{autoColumnsDraft}</span>
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
            value={gridGapDraft}
            onChange={(event) => setGridGapDraft(Number(event.currentTarget.value))}
            onPointerUp={commitGridGap}
            onKeyUp={(event) => {
              if (event.key === "Enter") {
                commitGridGap();
              }
            }}
            onBlur={commitGridGap}
          />
          <span className="settings-value">{gridGapDraft}px</span>
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
};
