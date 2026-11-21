// Fixed thumbnail sizes belong to tabs only while the preference is enabled.
import type { Tab } from "@/types/tabs";
import type { FixedGridSize, Settings } from "./settings.types";

export const FIXED_GRID_SIZES: readonly FixedGridSize[] = ["small", "normal", "large"];

export const coerceTabGridSize = (value: unknown): FixedGridSize | undefined =>
  FIXED_GRID_SIZES.find(size => size === value);

type GridPreferences = Pick<Settings, "gridSize" | "rememberTabGridSize">;

export const getDefaultTabGridSize = ({ gridSize, rememberTabGridSize }: GridPreferences) =>
  rememberTabGridSize && gridSize !== "auto" ? gridSize : undefined;

// Seed existing tabs when fixed per-tab sizing starts. Preset changes then only affect new tabs.
export const getTabGridSizeOnEnable = (next: GridPreferences, previous: GridPreferences) =>
  getDefaultTabGridSize(previous) ? undefined : getDefaultTabGridSize(next);

export const fillTabGridSizes = (tabs: Tab[], gridSize: FixedGridSize | undefined) =>
  gridSize && tabs.some(tab => !tab.gridSize)
    ? tabs.map(tab => tab.gridSize ? tab : { ...tab, gridSize })
    : tabs;
