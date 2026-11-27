// Grid-specific appearance and content controls.
import { SettingsPills } from "./SettingsPills";
import { shallow } from "zustand/shallow";
import {
  GRID_AUTO_COLUMNS_MAX,
  GRID_AUTO_COLUMNS_MIN,
  GRID_GAP_MAX,
  GRID_GAP_MIN,
  useSettingsStore,
} from "@/modules";
import type { GridNameEllipsis, GridSize } from "@/modules";
import { PressButton } from "@/components/primitives/PressButton";
import { useDeferredRange } from "./useDeferredRange";

import { SettingsGroup, SettingsItem } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

export const GRID_SETTINGS_ITEMS = {
  size: {
    label: "Grid size",
    description: "Choose a preset size or let the grid auto-fit by column count. Hold Ctrl and scroll over thumbnails to resize them.",
    keywords: "auto columns",
  },
  rememberTabSize: {
    label: "Remember grid size per tab",
    description: "Save Ctrl + scroll adjustments in each tab.",
    keywords: "thumbnail preset auto columns workspace",
  },
  autoColumns: {
    label: "Auto columns",
    description: "With per-tab sizing, this sets the default column count for new tabs.",
    keywords: "grid auto-fit",
    requiresAutoGrid: true,
  },
  gap: {
    label: "Grid gap",
    description: "Adjust the spacing between grid cards.",
  },
  corners: {
    label: "Grid corners",
    description: "Rounded cards or straight edges.",
  },
  centerGridItems: {
    label: "Center grid items",
    description: "Center cards within the pane when using a fixed grid size.",
    keywords: "alignment",
  },
  details: {
    label: "Grid details",
    description: "Name is always shown in grid cards.",
    keywords: "file size extension",
  },
  hideExtension: {
    label: "Hide extension in grid names",
    description: "Keep the base filename in the title line.",
  },
  nameTruncation: {
    label: "Grid name truncation",
    description: "Choose how long names are shortened. Middle keeps the ending visible.",
  },
} satisfies Record<string, SettingsItemText>;

type SettingsGridSectionProps = {
  sectionId: string;
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

export const SettingsGridSection = ({ sectionId }: SettingsGridSectionProps) => {
  const {
    gridSize,
    rememberTabGridSize,
    gridAutoColumns,
    gridGap,
    gridCentered,
    gridRounded,
    gridShowSize,
    gridShowExtension,
    gridNameEllipsis,
    gridNameHideExtension,
    updateSettings,
  } = useSettingsStore(
    (state) => ({
      gridSize: state.gridSize,
      rememberTabGridSize: state.rememberTabGridSize,
      gridAutoColumns: state.gridAutoColumns,
      gridGap: state.gridGap,
      gridCentered: state.gridCentered,
      gridRounded: state.gridRounded,
      gridShowSize: state.gridShowSize,
      gridShowExtension: state.gridShowExtension,
      gridNameEllipsis: state.gridNameEllipsis,
      gridNameHideExtension: state.gridNameHideExtension,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const autoColumnsRange = useDeferredRange({
    value: gridAutoColumns,
    onCommit: (value) => updateSettings({ gridAutoColumns: value }),
  });
  const gridGapRange = useDeferredRange({
    value: gridGap,
    onCommit: (value) => updateSettings({ gridGap: value }),
  });

  return (
    <SettingsGroup id={sectionId} title="Grid" items={Object.values(GRID_SETTINGS_ITEMS)}>
      <SettingsItem item={GRID_SETTINGS_ITEMS.size}>
        <SettingsPills aria-label="Grid size">
          {GRID_SIZES.map((size) => (
            <PressButton
              key={size.id}
              type="button"
              aria-pressed={gridSize === size.id}
              className={`settings-pill${gridSize === size.id ? " is-active" : ""}`}
              onClick={() => updateSettings({ gridSize: size.id })}
            >
              {size.label}
            </PressButton>
          ))}
        </SettingsPills>
      </SettingsItem>
      {gridSize === "auto" ? (
        <SettingsItem item={GRID_SETTINGS_ITEMS.autoColumns}>
          <div className="settings-range">
            <input
              type="range"
              className="ui-range"
              aria-label={GRID_SETTINGS_ITEMS.autoColumns.label}
              min={GRID_AUTO_COLUMNS_MIN}
              max={GRID_AUTO_COLUMNS_MAX}
              step={1}
              {...autoColumnsRange.bind}
            />
            <span className="settings-value">{autoColumnsRange.draft}</span>
          </div>
        </SettingsItem>
      ) : null}
      <SettingsItem item={GRID_SETTINGS_ITEMS.rememberTabSize}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={GRID_SETTINGS_ITEMS.rememberTabSize.label}
            checked={rememberTabGridSize}
            onChange={(event) => updateSettings({ rememberTabGridSize: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={GRID_SETTINGS_ITEMS.gap}>
        <div className="settings-range">
          <input
            type="range"
            className="ui-range"
            min={GRID_GAP_MIN}
            max={GRID_GAP_MAX}
            step={1}
            {...gridGapRange.bind}
          />
          <span className="settings-value">{gridGapRange.draft}px</span>
        </div>
      </SettingsItem>
      <SettingsItem item={GRID_SETTINGS_ITEMS.centerGridItems}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label={GRID_SETTINGS_ITEMS.centerGridItems.label}
            checked={gridCentered}
            onChange={(event) => updateSettings({ gridCentered: event.currentTarget.checked })}
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={GRID_SETTINGS_ITEMS.corners}>
        <SettingsPills aria-label="Grid corners">
          <PressButton
            type="button"
            className={`settings-pill${gridRounded ? " is-active" : ""}`}
            onClick={() => updateSettings({ gridRounded: true })}
          >
            Rounded
          </PressButton>
          <PressButton
            type="button"
            className={`settings-pill${gridRounded ? "" : " is-active"}`}
            onClick={() => updateSettings({ gridRounded: false })}
          >
            Straight
          </PressButton>
        </SettingsPills>
      </SettingsItem>
      <SettingsItem item={GRID_SETTINGS_ITEMS.details}>
        <SettingsPills aria-label="Grid details">
          <label
            className={`settings-pill settings-pill-check${gridShowSize ? " is-active" : ""}`}
          >
            <input
              type="checkbox"
              checked={gridShowSize}
              onChange={(event) =>
                updateSettings({ gridShowSize: event.currentTarget.checked })
              }
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
                updateSettings({ gridShowExtension: event.currentTarget.checked })
              }
            />
            <span>Extension</span>
          </label>
        </SettingsPills>
      </SettingsItem>
      <SettingsItem item={GRID_SETTINGS_ITEMS.hideExtension}>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={gridNameHideExtension}
            onChange={(event) =>
              updateSettings({ gridNameHideExtension: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </SettingsItem>
      <SettingsItem item={GRID_SETTINGS_ITEMS.nameTruncation}>
        <SettingsPills aria-label="Grid name truncation">
          {GRID_NAME_ELLIPSIS.map((mode) => (
            <PressButton
              key={mode.id}
              type="button"
              className={`settings-pill${gridNameEllipsis === mode.id ? " is-active" : ""}`}
              onClick={() => updateSettings({ gridNameEllipsis: mode.id })}
            >
              {mode.label}
            </PressButton>
          ))}
        </SettingsPills>
      </SettingsItem>
    </SettingsGroup>
  );
};
