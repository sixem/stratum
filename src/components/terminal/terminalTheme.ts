// Resolve the app colors or a built-in palette for xterm's renderer.
import type { ITheme } from "@xterm/xterm";
import { DEFAULT_TERMINAL_THEME, type TerminalThemeId } from "@/modules/terminalThemes";

type AnsiPair = readonly [normal: string, bright: string];
type AnsiPalette = Record<"red" | "green" | "yellow" | "blue" | "magenta" | "cyan", AnsiPair>;
type TerminalPalette = AnsiPalette & {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  accentRgb: string;
  brightWhite?: string;
};

type ResolvedTheme = ITheme & { background: string; foreground: string; brightBlack: string };

const APP_ANSI: AnsiPalette = {
  red: ["#e98489", "#ffa5a8"],
  green: ["#83cba2", "#a5e3bc"],
  yellow: ["#e8c178", "#f6d996"],
  blue: ["#84aef0", "#a6c7fc"],
  magenta: ["#c6a0ee", "#dfbdff"],
  cyan: ["#7bcad7", "#a0e1eb"],
};

const PRESETS: Record<Exclude<TerminalThemeId, typeof DEFAULT_TERMINAL_THEME>, TerminalPalette> = {
  "event-horizon": {
    background: "#08090d",
    foreground: "#e6eaf2",
    muted: "#8591a4",
    accent: "#b8c6fa",
    accentRgb: "133, 152, 228",
    red: ["#ea7f8d", "#ffa3aa"],
    green: ["#8bcca8", "#ade7c3"],
    yellow: ["#e9c880", "#f6dd9c"],
    blue: ["#88a8f5", "#aec4ff"],
    magenta: ["#baa6e6", "#d5bef7"],
    cyan: ["#89d0da", "#b2e8ed"],
  },
  "blue-hour": {
    background: "#0d192d",
    foreground: "#e0edff",
    muted: "#92a6c4",
    accent: "#95c6ff",
    accentRgb: "93, 151, 239",
    red: ["#fb8d9f", "#ffb1bc"],
    green: ["#80d6af", "#a4f0ca"],
    yellow: ["#ebcb93", "#fde3b0"],
    blue: ["#79a9ff", "#a7cdff"],
    magenta: ["#c2a4f0", "#ddc9ff"],
    cyan: ["#81d8ee", "#aaf0fa"],
  },
  "deep-current": {
    background: "#091918",
    foreground: "#d9efea",
    muted: "#8aada5",
    accent: "#6ce0cc",
    accentRgb: "58, 177, 157",
    red: ["#ee9290", "#ffb1af"],
    green: ["#82d29a", "#a8e9b8"],
    yellow: ["#dfc77f", "#f6dda0"],
    blue: ["#8dafec", "#acc9ff"],
    magenta: ["#c6a5d8", "#e3c3ed"],
    cyan: ["#65cebe", "#97eedb"],
  },
  ember: {
    background: "#1a1110",
    foreground: "#f6e4db",
    muted: "#bb9d91",
    accent: "#ffac76",
    accentRgb: "220, 124, 76",
    red: ["#ef887d", "#ffaaa1"],
    green: ["#a5c587", "#c1dfa0"],
    yellow: ["#edbd77", "#ffd89d"],
    blue: ["#92b1de", "#b3caff"],
    magenta: ["#d2a0cd", "#edbce9"],
    cyan: ["#8fc9c3", "#b9e9db"],
  },
  "night-bloom": {
    background: "#190f20",
    foreground: "#f2e5f6",
    muted: "#b8a1bf",
    accent: "#edaaf6",
    accentRgb: "177, 100, 205",
    red: ["#f38ba5", "#ffb1c4"],
    green: ["#9ad3a5", "#b8ebc1"],
    yellow: ["#eac190", "#faddae"],
    blue: ["#a2aefa", "#bfc9ff"],
    magenta: ["#d5a2eb", "#efc0fa"],
    cyan: ["#8bcad6", "#b1e5ef"],
  },
  moonstone: {
    background: "#e9edf1",
    foreground: "#273342",
    muted: "#526378",
    accent: "#3d5d85",
    accentRgb: "98, 135, 184",
    brightWhite: "#172434",
    red: ["#a4344a", "#93223f"],
    green: ["#316c51", "#255d3b"],
    yellow: ["#77521c", "#643d10"],
    blue: ["#315f96", "#244d92"],
    magenta: ["#724c8b", "#69347f"],
    cyan: ["#276777", "#185867"],
  },
};

const readAppPalette = (surface: HTMLElement): TerminalPalette => {
  const styles = getComputedStyle(surface);
  return {
    ...APP_ANSI,
    background: styles.getPropertyValue("--bg").trim(),
    foreground: styles.getPropertyValue("--text").trim(),
    muted: styles.getPropertyValue("--muted").trim(),
    accent: styles.getPropertyValue("--accent").trim(),
    accentRgb: styles.getPropertyValue("--accent-rgb").trim(),
  };
};

export const readTerminalTheme = (surface: HTMLElement, preference: TerminalThemeId): ResolvedTheme => {
  const palette = preference === DEFAULT_TERMINAL_THEME ? readAppPalette(surface) : PRESETS[preference];
  const { background, foreground, accent, accentRgb } = palette;
  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: `rgba(${accentRgb}, 0.34)`,
    selectionInactiveBackground: `rgba(${accentRgb}, 0.17)`,
    black: background,
    red: palette.red[0],
    green: palette.green[0],
    yellow: palette.yellow[0],
    blue: palette.blue[0],
    magenta: palette.magenta[0],
    cyan: palette.cyan[0],
    white: foreground,
    brightBlack: palette.muted,
    brightRed: palette.red[1],
    brightGreen: palette.green[1],
    brightYellow: palette.yellow[1],
    brightBlue: palette.blue[1],
    brightMagenta: palette.magenta[1],
    brightCyan: palette.cyan[1],
    brightWhite: palette.brightWhite ?? "#ffffff",
  };
};
