// Tabs can keep separate sizes for fixed and automatic thumbnail layouts.
import { GRID_AUTO_COLUMNS_MAX, GRID_AUTO_COLUMNS_MIN } from "@/constants/settings";
import type { Tab } from "@/types/tabs";
import type { FixedGridSize, Settings } from "./settings.types";

export const FIXED_GRID_SIZES: readonly FixedGridSize[] = ["small", "normal", "large"];
export type TabGridSize = FixedGridSize | number;

export const coerceTabGridSize = (value: unknown): FixedGridSize | undefined =>
  FIXED_GRID_SIZES.find(size => size === value);

export const clampAutoColumns = (value: number) =>
  Math.min(GRID_AUTO_COLUMNS_MAX, Math.max(GRID_AUTO_COLUMNS_MIN, Math.round(value)));

export const coerceTabAutoColumns = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? clampAutoColumns(value) : undefined;

type GridPreferences = Pick<Settings, "gridSize" | "gridAutoColumns" | "rememberTabGridSize">;

export const getDefaultTabGridSize = ({ gridSize, gridAutoColumns, rememberTabGridSize }: GridPreferences): TabGridSize | undefined => {
  if (!rememberTabGridSize) return undefined;
  return gridSize === "auto" ? gridAutoColumns : gridSize;
};

export const readTabGridSize = (tab: Tab | undefined, defaultSize: TabGridSize | undefined): TabGridSize | undefined => {
  if (defaultSize === undefined) return undefined;
  return typeof defaultSize === "number" ? tab?.gridAutoColumns : tab?.gridSize;
};

export const withTabGridSize = <T extends Tab>(tab: T, size: TabGridSize): T => {
  if (readTabGridSize(tab, size) === size) return tab;
  return typeof size === "number" ? { ...tab, gridAutoColumns: size } : { ...tab, gridSize: size };
};

export const seedTabGridSize = <T extends Tab>(tab: T, defaultSize: TabGridSize | undefined): T =>
  defaultSize !== undefined && readTabGridSize(tab, defaultSize) === undefined
    ? withTabGridSize(tab, defaultSize) : tab;

// Seed missing sizes on enable or mode changes. Changing a default in the same mode only affects new tabs.
export const getTabGridSizeOnEnable = (next: GridPreferences, previous: GridPreferences) => {
  const nextDefault = getDefaultTabGridSize(next);
  return typeof nextDefault !== typeof getDefaultTabGridSize(previous) ? nextDefault : undefined;
};

export const fillTabGridSizes = (tabs: Tab[], defaultSize: TabGridSize | undefined) =>
  defaultSize !== undefined && tabs.some(tab => readTabGridSize(tab, defaultSize) === undefined)
    ? tabs.map(tab => seedTabGridSize(tab, defaultSize))
    : tabs;
