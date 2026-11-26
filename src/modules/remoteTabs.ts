// Keep remote navigation scoped to its host and independent of Windows path handling.
import type { RemoteTab } from "@/types/tabs";
import type { LinkedPane } from "@/lib/paneLink";
import { firstUnanchoredTabIndex } from "@/lib/tabAnchors";
import { createSessionTab, getPaneSessionStore } from "./sessionStore";
import { useSettingsStore } from "./settings.store";
import { setBottomPaneActive } from "./bottomPaneStore";

export function openRemoteTab(hostId: string, path: string, pane: LinkedPane) {
  const store = getPaneSessionStore(pane).getState();
  const current = store.tabs.findIndex(t => t.id === store.activeTabId);
  const base = createSessionTab("", { sort: store.tabs[current]?.sort });
  const tab: RemoteTab = { ...base, kind: "remote", split: undefined, crumbTrailPath: path, remote: { hostId, path } };
  const position = current < 0 ? store.tabs.length : Math.max(current + 1, firstUnanchoredTabIndex(store.tabs));
  const tabs = store.tabs.slice();
  tabs.splice(position, 0, tab);
  store.updateSession({ tabs, activeTabId: tab.id });
  setBottomPaneActive(pane === "bottom");
}

export function updateRemoteTab(pane: LinkedPane, id: string, change: (tab: RemoteTab) => RemoteTab) {
  getPaneSessionStore(pane).getState().setTabs(tabs => tabs.map(tab =>
    tab.id === id && tab.kind === "remote" ? applyRemoteChange(tab, change) : tab));
}

export function applyRemoteChange(tab: RemoteTab, change: (tab: RemoteTab) => RemoteTab) {
  const next = change(tab);
  if (next.remote.path !== tab.remote.path && !useSettingsStore.getState().keepFilterOnNavigation) {
    return { ...next, search: "" };
  }
  return next;
}
