// Use installed font family names with the same fallback in the preview and shell.
export const DEFAULT_TERMINAL_FONT_STACK = 'Consolas, "Cascadia Mono", "Stratum Terminal Symbols", monospace';

export const coerceTerminalFont = (value: unknown): string | null => {
  const name = typeof value === "string" ? value.trim() : "";
  return name && name.length <= 256 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
};

export const terminalFontStack = (value: string | null) => {
  const name = coerceTerminalFont(value);
  if (!name) return DEFAULT_TERMINAL_FONT_STACK;
  // xterm interpolates this into CSS. Quote the family so punctuation stays part of its name.
  const quoted = '"' + name.replace(/["\\]/g, "\\$&") + '"';
  return quoted + ", " + DEFAULT_TERMINAL_FONT_STACK;
};

export const findInstalledTerminalFont = (fonts: readonly string[], preference: string | null) => {
  const name = preference?.toLowerCase();
  return fonts.find(font => font.toLowerCase() === name) ?? null;
};
