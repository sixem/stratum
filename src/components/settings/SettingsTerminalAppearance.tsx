// Match the embedded terminal's colors and type without starting a shell.
import { useContext, useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { shallow } from "zustand/shallow";
import { listTerminalFonts } from "@/api/system";
import { DropdownSelect } from "@/components/primitives/DropdownSelect";
import { resolveTerminalTheme } from "@/components/terminal/terminalTheme";
import { useSettingsStore } from "@/modules/settings.store";
import { coerceTerminalFont, findInstalledTerminalFont, terminalFontStack } from "@/modules/terminalFonts";
import {
  coerceTerminalCursorStyle, coerceTerminalFontWeight, coerceTerminalScrollback, DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_CURSOR_STYLES, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_WEIGHTS, TERMINAL_SCROLLBACK_LENGTHS,
} from "@/modules/terminalPreferences";
import { coerceTerminalTheme, TERMINAL_THEME_OPTIONS } from "@/modules/terminalThemes";
import { SettingsGroup, SettingsItem, SettingsSearchMatches } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";
import { useDeferredRange } from "./useDeferredRange";

export const TERMINAL_APPEARANCE_ITEMS = {
  terminalTheme: {
    label: "Terminal theme",
    description: "Choose a color palette for PowerShell tabs.",
    keywords: "shell console appearance",
  },
  terminalFont: {
    label: "Terminal font",
    description: "Choose an installed monospace font.",
    keywords: "shell console typeface font family",
  },
  terminalFontSize: {
    label: "Font size",
    description: "Adjust terminal text size.",
    keywords: "terminal shell zoom",
  },
  terminalFontWeight: {
    label: "Font weight",
    description: "Set the weight of regular terminal text.",
    keywords: "terminal shell bold medium semibold",
  },
  terminalCursorStyle: {
    label: "Cursor shape",
    description: "Choose the terminal’s typing cursor.",
    keywords: "terminal shell caret block bar underline",
  },
  terminalScrollback: {
    label: "Scrollback",
    description: "Set how many lines of terminal output to keep.",
    keywords: "terminal shell buffer history scroll length",
  },
} satisfies Record<string, SettingsItemText>;

const themeGroups = [{ id: "terminal-themes", options: [...TERMINAL_THEME_OPTIONS] }];
const weightGroups = [{ id: "terminal-weights", options: TERMINAL_FONT_WEIGHTS.map(({ value, label }) => ({ value: String(value), label })) }];
const cursorGroups = [{ id: "terminal-cursors", options: [...TERMINAL_CURSOR_STYLES] }];
const scrollbackGroups = [{ id: "terminal-scrollback", options: TERMINAL_SCROLLBACK_LENGTHS.map(value => ({
  value: String(value), label: `${value.toLocaleString()} lines`,
})) }];
const terminalItems = Object.values(TERMINAL_APPEARANCE_ITEMS);
const previewItems = terminalItems.filter(item => item !== TERMINAL_APPEARANCE_ITEMS.terminalScrollback);

export function SettingsTerminalAppearance({ id, open }: { id: string; open: boolean }) {
  const matches = useContext(SettingsSearchMatches);
  const showFonts = !matches || matches.has(TERMINAL_APPEARANCE_ITEMS.terminalFont);
  const showPreview = !matches || previewItems.some(item => matches.has(item));
  const { terminalTheme, terminalFontFamily, terminalFontSize, terminalFontWeight, terminalCursorStyle, terminalScrollback, updateSettings } = useSettingsStore(
    state => ({
      terminalTheme: state.terminalTheme,
      terminalFontFamily: state.terminalFontFamily,
      terminalFontSize: state.terminalFontSize,
      terminalFontWeight: state.terminalFontWeight,
      terminalCursorStyle: state.terminalCursorStyle,
      terminalScrollback: state.terminalScrollback,
      updateSettings: state.updateSettings,
    }),
    shallow,
  );
  const fontSizeRange = useDeferredRange({
    value: terminalFontSize,
    onCommit: value => updateSettings({ terminalFontSize: value }),
  });
  const [fonts, setFonts] = useState<string[] | null>(null);
  const [fontsUnavailable, setFontsUnavailable] = useState(false);

  useEffect(() => {
    if (!showFonts || !open || !isTauri()) return;
    let active = true;
    void listTerminalFonts().then(names => {
      if (!active) return;
      const installed = names.map(coerceTerminalFont).filter(name => name !== null);
      setFonts(installed);
      setFontsUnavailable(false);
      const settings = useSettingsStore.getState();
      if (settings.terminalFontFamily && !findInstalledTerminalFont(installed, settings.terminalFontFamily)) {
        settings.updateSettings({ terminalFontFamily: null });
      }
    }).catch(() => {
      if (active) setFontsUnavailable(true);
    });
    return () => { active = false; };
  }, [open, showFonts]);

  const selectedFont = fonts ? findInstalledTerminalFont(fonts, terminalFontFamily) : terminalFontFamily;
  const fontGroups = useMemo(() => [{
    id: "terminal-fonts",
    options: (fonts ?? (selectedFont ? [selectedFont] : [])).map(name => ({ value: name, label: name })),
  }], [fonts, selectedFont]);
  const colors = resolveTerminalTheme(terminalTheme);

  return <SettingsGroup id={id} title="Terminal" items={terminalItems}>
    <SettingsItem item={TERMINAL_APPEARANCE_ITEMS.terminalTheme}>
      <DropdownSelect
        value={terminalTheme}
        ariaLabel={TERMINAL_APPEARANCE_ITEMS.terminalTheme.label}
        className="settings-terminal-select"
        groups={themeGroups}
        onChange={value => updateSettings({ terminalTheme: coerceTerminalTheme(value) })}
      />
    </SettingsItem>
    <SettingsItem item={TERMINAL_APPEARANCE_ITEMS.terminalFont}
      details={fontsUnavailable ? <div className="settings-desc">Couldn’t read installed fonts.</div> : undefined}>
      <DropdownSelect
        value={selectedFont}
        placeholder="Default"
        ariaLabel={TERMINAL_APPEARANCE_ITEMS.terminalFont.label}
        className="settings-terminal-select"
        groups={fontGroups}
        onChange={value => updateSettings({ terminalFontFamily: value })}
      />
    </SettingsItem>
    <SettingsItem item={TERMINAL_APPEARANCE_ITEMS.terminalFontSize}>
      <div className="settings-range settings-terminal-size">
        <input
          type="range"
          className="ui-range"
          aria-label="Terminal font size"
          min={TERMINAL_FONT_SIZE_MIN}
          max={TERMINAL_FONT_SIZE_MAX}
          step={1}
          {...fontSizeRange.bind}
          onKeyUp={fontSizeRange.commit}
        />
        <span className="settings-value">{fontSizeRange.draft}</span>
        <button type="button" className="btn ghost" aria-label="Reset terminal font size"
          disabled={fontSizeRange.draft === DEFAULT_TERMINAL_FONT_SIZE}
          onClick={() => updateSettings({ terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE })}>
          Reset
        </button>
      </div>
    </SettingsItem>
    <SettingsItem item={TERMINAL_APPEARANCE_ITEMS.terminalFontWeight}>
      <DropdownSelect
        value={String(terminalFontWeight)}
        ariaLabel="Terminal font weight"
        className="settings-terminal-select"
        groups={weightGroups}
        onChange={value => updateSettings({ terminalFontWeight: coerceTerminalFontWeight(Number(value)) })}
      />
    </SettingsItem>
    <SettingsItem item={TERMINAL_APPEARANCE_ITEMS.terminalCursorStyle}>
      <DropdownSelect
        value={terminalCursorStyle}
        ariaLabel="Terminal cursor shape"
        className="settings-terminal-select"
        groups={cursorGroups}
        onChange={value => updateSettings({ terminalCursorStyle: coerceTerminalCursorStyle(value) })}
      />
    </SettingsItem>
    <SettingsItem item={TERMINAL_APPEARANCE_ITEMS.terminalScrollback}>
      <DropdownSelect
        value={String(terminalScrollback)}
        ariaLabel="Terminal scrollback"
        className="settings-terminal-select"
        groups={scrollbackGroups}
        onChange={value => updateSettings({ terminalScrollback: coerceTerminalScrollback(Number(value)) })}
      />
    </SettingsItem>
    {showPreview && (
      <div className="settings-terminal-preview" role="group" aria-label="Terminal appearance preview" style={{
        backgroundColor: colors.background, color: colors.foreground,
        fontFamily: terminalFontStack(selectedFont), fontSize: `${fontSizeRange.draft / 16}rem`, fontWeight: terminalFontWeight,
      }}>
        <div><span style={{ color: colors.cursor }}>PS C:\Projects&gt;</span>{" "}.\build.ps1</div>
        <div>Build complete{"  "}<strong style={{ color: colors.yellow, fontWeight: 700 }}>1 warning</strong></div>
        <div><span style={{ color: colors.cursor }}>PS C:\Projects&gt;</span>{" "}
          <span aria-hidden="true" className="settings-terminal-cursor" data-shape={terminalCursorStyle} style={{ color: colors.cursor }} />
        </div>
      </div>
    )}
  </SettingsGroup>;
}
