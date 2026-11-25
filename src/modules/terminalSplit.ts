import { create } from "zustand";
import type { Tab } from "@/types";
import type { LinkedPane } from "@/lib/paneLink";
import { getPaneSessionStore } from "./sessionStore";
import { useBottomPaneStore, setBottomPaneActive } from "./bottomPaneStore";

type SplitSource = {
  pane: LinkedPane;
  id: string;
  key: string;
  closeTab: (id: string) => void;
};

export const useSplitPicker = create<{ source: SplitSource | null }>(() => ({ source: null }));
export const cancelSplitPicker = () => useSplitPicker.setState({ source: null });
export const canPairFolder = (tab: Tab) => tab.kind === "folder" && Boolean(tab.path) && !tab.split;

export function hasSplitTarget() {
  return getPaneSessionStore("main").getState().tabs.some(canPairFolder) ||
    (useBottomPaneStore.getState().open && getPaneSessionStore("bottom").getState().tabs.some(canPairFolder));
}

export function beginSplitPicker(pane: LinkedPane, tab: Tab, closeTab: SplitSource["closeTab"]) {
  if (tab.terminal && !tab.anchored && hasSplitTarget()) {
    useSplitPicker.setState({ source: { pane, id: tab.id, key: tab.terminal.key, closeTab } });
  }
}

export function pairWithFolder(pane: LinkedPane, id: string, selectTab: (id: string) => void) {
  const { source } = useSplitPicker.getState();
  if (!source) return;
  const sourceTab = getPaneSessionStore(source.pane).getState().tabs.find(tab => tab.id === source.id);
  const terminal = sourceTab?.terminal;
  const dest = getPaneSessionStore(pane).getState();
  const folder = dest.tabs.find(tab => tab.id === id);
  cancelSplitPicker();
  if (sourceTab?.anchored || !terminal || terminal.key !== source.key || !folder || !canPairFolder(folder)) return;

  if (dest.activeTabId !== id) selectTab(id);
  // Publish the new owner before releasing the standalone tab. This also keeps
  // the folder's ID, navigation history and scroll position across pane moves.
  dest.setTabs(tabs => tabs.map(tab => tab.id === id && tab.kind === "folder"
    ? { ...tab, split: { terminal, folderPercent: 50 } } : tab));
  source.closeTab(source.id);
  setBottomPaneActive(pane === "bottom");
}

export function setTerminalSplitSize(pane: LinkedPane, id: string, folderPercent: number) {
  getPaneSessionStore(pane).getState().setTabs(tabs => tabs.map(tab =>
    tab.id === id && tab.split && tab.split.folderPercent !== folderPercent
      ? { ...tab, split: { ...tab.split, folderPercent } } : tab));
}

export function swapTerminalSplitSides(pane: LinkedPane, id: string) {
  getPaneSessionStore(pane).getState().setTabs(tabs => tabs.map(tab =>
    tab.id === id && tab.split ? { ...tab, split: { ...tab.split, terminalFirst: !tab.split.terminalFirst } } : tab));
}

export function toggleTerminalSplitLayout(pane: LinkedPane, id: string) {
  getPaneSessionStore(pane).getState().setTabs(tabs => tabs.map(tab =>
    tab.id === id && tab.split ? { ...tab, split: { ...tab.split, stacked: !tab.split.stacked } } : tab));
}

export function setDirectoryLinked(pane: LinkedPane, id: string, linked: boolean) {
  getPaneSessionStore(pane).getState().setTabs(tabs => tabs.map(tab =>
    tab.id === id && tab.split ? { ...tab, split: { ...tab.split, linkDirectory: linked } } : tab));
}

// Keep the reported directory with the shell descriptor across restarts and tab moves.
export function saveTerminalDirectory(pane: LinkedPane, id: string, key: string, directory: string) {
  getPaneSessionStore(pane).getState().setTabs(tabs => {
    const index = tabs.findIndex(tab => tab.id === id);
    const tab = tabs[index];
    const terminal = tab?.terminal ?? tab?.split?.terminal;
    if (!terminal || terminal.key !== key || terminal.directory === directory) return tabs;
    const next = [...tabs];
    const updated = { ...terminal, directory };
    if (tab.kind === "terminal") next[index] = { ...tab, terminal: updated };
    else if (tab.split) next[index] = { ...tab, split: { ...tab.split, terminal: updated } };
    return next;
  });
}

type Navigate = (tab: Tab, path: string) => void;
const receivers = new Map<LinkedPane, Navigate>();

export function registerShellNavigation(pane: LinkedPane, navigate: Navigate) {
  receivers.set(pane, navigate);
  return () => { receivers.delete(pane); };
}

export function showShellDirectory(pane: LinkedPane, tab: Tab, path: string) {
  const navigate = receivers.get(pane);
  if (navigate) navigate(tab, path);
  else rememberShellDirectory(pane, tab.id, path);
}

export function rememberShellDirectory(pane: LinkedPane, id: string, path: string) {
  getPaneSessionStore(pane).getState().setTabs(tabs => tabs.map(tab =>
    tab.id === id ? { ...tab, path, crumbTrailPath: path, scrollTop: 0 } : tab));
}
