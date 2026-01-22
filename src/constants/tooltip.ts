// Tooltip timing and spacing defaults.
export const DEFAULT_TOOLTIP_DELAY_MS = 200;
export const FILE_TOOLTIP_DELAY_MS = 1000;
export const TOOLTIP_EDGE_PADDING = 12;
export const TOOLTIP_GAP = 8;

export const clampTooltipDelay = (value: number) => {
  if (value < 0) return 0;
  if (value > 1000) return 1000;
  return value;
};
