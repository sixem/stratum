// Restore tab descriptors while leaving PowerShell processes dormant.
import type { FolderTab, Tab, TerminalSession, TerminalSplit, TerminalTab } from "@/types/tabs";

type SavedTabContent = { kind?: unknown; path?: unknown; terminal?: unknown; split?: unknown };
type TabContent = Pick<FolderTab, "kind" | "split"> | Pick<TerminalTab, "kind" | "terminal">;
type TabLayout = { tabs: Tab[]; activeTabId: string | null };

export const TERMINAL_SPLIT_MIN = 20;
export const TERMINAL_SPLIT_MAX = 80;
export const clampTerminalSplit = (value: number) => Math.max(TERMINAL_SPLIT_MIN, Math.min(TERMINAL_SPLIT_MAX, value));

const readTerminal = (value: unknown, key: string): TerminalSession | undefined => {
  if (!value || typeof value !== "object" || !("directory" in value)) return;
  const { directory } = value;
  if (typeof directory === "string" && !directory.includes("\0")) return { key, directory };
};

const readSplit = (value: unknown, key: string): TerminalSplit | undefined => {
  if (!value || typeof value !== "object") return;
  const raw = value as Partial<Record<keyof TerminalSplit, unknown>>;
  const terminal = readTerminal(raw.terminal, key);
  if (!terminal) return;
  return {
    terminal,
    folderPercent: typeof raw.folderPercent === "number" && Number.isFinite(raw.folderPercent)
      ? clampTerminalSplit(raw.folderPercent) : 50,
    linkDirectory: raw.linkDirectory === true || undefined,
    terminalFirst: raw.terminalFirst === true || undefined,
    stacked: raw.stacked === true || undefined,
  };
};

export function readTabContent(saved: SavedTabContent, key: string): TabContent | null {
  // Older sessions inferred a terminal from its descriptor and empty path.
  if (saved.kind === "terminal" || (saved.kind === undefined && saved.path === "" && saved.terminal !== undefined)) {
    const terminal = readTerminal(saved.terminal, key);
    return terminal ? { kind: "terminal", terminal } : null;
  }
  const split = typeof saved.path === "string" && saved.path.trim() ? readSplit(saved.split, key) : undefined;
  return { kind: "folder", split };
}

export function selectRestoredFolder(layout: TabLayout): TabLayout {
  const { tabs, activeTabId } = layout;
  if (!tabs.length) return layout;
  const active = tabs.find(tab => tab.id === activeTabId);
  if (active?.kind === "folder" && !active.split) return layout;

  const folder = tabs.find(tab => tab.kind === "folder" && !tab.split);
  // With only dormant terminals, show Start without adding a tab to the layout.
  return { tabs, activeTabId: folder?.id ?? null };
}
