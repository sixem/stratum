// Match the embedded terminal's colors and type without starting a shell.
import { useContext, useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { shallow } from "zustand/shallow";
import { listTerminalFonts } from "@/api/system";
import { DropdownSelect } from "@/components/primitives/DropdownSelect";
import { resolveTerminalTheme } from "@/components/terminal/terminalTheme";
import { useSettingsStore } from "@/modules/settings.store";
import { coerceTerminalFont, findInstalledTerminalFont, terminalFontStack } from "@/modules/terminalFonts";
import { coerceTerminalTheme, TERMINAL_THEME_OPTIONS } from "@/modules/terminalThemes";
import { SettingsItem, SettingsSearchMatches } from "./SettingsItem";
import type { SettingsItemText } from "./SettingsItem";

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
} satisfies Record<string, SettingsItemText>;

const themeGroups = [{ id: "terminal-themes", options: [...TERMINAL_THEME_OPTIONS] }];

export function SettingsTerminalAppearance({ open }: { open: boolean }) {
  const matches = useContext(SettingsSearchMatches);
  const showFonts = !matches || matches.has(TERMINAL_APPEARANCE_ITEMS.terminalFont);
  const { terminalTheme, terminalFontFamily, updateSettings } = useSettingsStore(
    state => ({ terminalTheme: state.terminalTheme, terminalFontFamily: state.terminalFontFamily, updateSettings: state.updateSettings }),
    shallow,
  );
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
  const preview = (
    <div className="settings-terminal-preview" role="group" aria-label="Terminal appearance preview"
      style={{ backgroundColor: colors.background, color: colors.foreground, fontFamily: terminalFontStack(selectedFont) }}>
      <div><span style={{ color: colors.cursor }}>PS C:\Projects&gt;</span>{" "}.\build.ps1</div>
      <div>Build complete{"  "}<span style={{ color: colors.yellow }}>1 warning</span></div>
    </div>
  );

  return <>
    <SettingsItem item={TERMINAL_APPEARANCE_ITEMS.terminalTheme}>
      <DropdownSelect
        value={terminalTheme}
        ariaLabel={TERMINAL_APPEARANCE_ITEMS.terminalTheme.label}
        className="settings-terminal-theme-select"
        groups={themeGroups}
        onChange={value => updateSettings({ terminalTheme: coerceTerminalTheme(value) })}
      />
      {!showFonts && preview}
    </SettingsItem>
    <SettingsItem item={TERMINAL_APPEARANCE_ITEMS.terminalFont}
      details={fontsUnavailable ? <div className="settings-desc">Couldn’t read installed fonts.</div> : undefined}>
      <DropdownSelect
        value={selectedFont}
        placeholder="Default"
        ariaLabel={TERMINAL_APPEARANCE_ITEMS.terminalFont.label}
        className="settings-terminal-font-select"
        groups={fontGroups}
        onChange={value => updateSettings({ terminalFontFamily: value })}
      />
      {preview}
    </SettingsItem>
  </>;
}
