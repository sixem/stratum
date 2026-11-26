// Keep terminal options bounded and available without loading xterm.
export const TERMINAL_FONT_SIZE_MIN = 10;
export const TERMINAL_FONT_SIZE_MAX = 24;
export const DEFAULT_TERMINAL_FONT_SIZE = 14;

export const TERMINAL_FONT_WEIGHTS = [
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
] as const;

export const TERMINAL_CURSOR_STYLES = [
  { value: "block", label: "Block" },
  { value: "bar", label: "Bar" },
  { value: "underline", label: "Underline" },
] as const;

export const TERMINAL_SCROLLBACK_LENGTHS = [1500, 5000, 10000] as const;

export type TerminalFontWeight = typeof TERMINAL_FONT_WEIGHTS[number]["value"];
export type TerminalCursorStyle = typeof TERMINAL_CURSOR_STYLES[number]["value"];
export type TerminalScrollback = typeof TERMINAL_SCROLLBACK_LENGTHS[number];

export const DEFAULT_TERMINAL_FONT_WEIGHT = TERMINAL_FONT_WEIGHTS[0].value;
export const DEFAULT_TERMINAL_CURSOR_STYLE = TERMINAL_CURSOR_STYLES[0].value;
export const DEFAULT_TERMINAL_SCROLLBACK = TERMINAL_SCROLLBACK_LENGTHS[0];

export const coerceTerminalFontSize = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(TERMINAL_FONT_SIZE_MIN, Math.min(TERMINAL_FONT_SIZE_MAX, Math.round(value)))
    : DEFAULT_TERMINAL_FONT_SIZE;

export const coerceTerminalFontWeight = (value: unknown): TerminalFontWeight =>
  TERMINAL_FONT_WEIGHTS.find(option => option.value === value)?.value ?? DEFAULT_TERMINAL_FONT_WEIGHT;

export const coerceTerminalCursorStyle = (value: unknown): TerminalCursorStyle =>
  TERMINAL_CURSOR_STYLES.find(option => option.value === value)?.value ?? DEFAULT_TERMINAL_CURSOR_STYLE;

export const coerceTerminalScrollback = (value: unknown): TerminalScrollback =>
  TERMINAL_SCROLLBACK_LENGTHS.find(option => option === value) ?? DEFAULT_TERMINAL_SCROLLBACK;
