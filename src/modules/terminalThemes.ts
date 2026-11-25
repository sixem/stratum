// Keep persisted theme IDs and the Flair picker in sync without loading xterm.
export const TERMINAL_THEME_OPTIONS = [
  { value: "follow-app", label: "Follow app" },
  { value: "event-horizon", label: "Event Horizon" },
  { value: "blue-hour", label: "Blue Hour" },
  { value: "deep-current", label: "Deep Current" },
  { value: "ember", label: "Ember" },
  { value: "night-bloom", label: "Night Bloom" },
  { value: "moonstone", label: "Moonstone" },
] as const;

export type TerminalThemeId = typeof TERMINAL_THEME_OPTIONS[number]["value"];

export const DEFAULT_TERMINAL_THEME = TERMINAL_THEME_OPTIONS[0].value;

export const coerceTerminalTheme = (value: unknown): TerminalThemeId =>
  TERMINAL_THEME_OPTIONS.find((option) => option.value === value)?.value ?? DEFAULT_TERMINAL_THEME;
