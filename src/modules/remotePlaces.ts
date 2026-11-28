// Open saved SFTP locations in the chosen pane and reuse the host's shared connection.
import type { LinkedPane } from "@/lib/paneLink";
import type { RemoteLocation } from "@/types/tabs";
import { setBottomPaneActive } from "./bottomPaneStore";
import { connectRemote, useRemoteHosts, type RemoteProfile } from "./remoteHosts";
import { openRemoteTab } from "./remoteTabs";
import { getPaneSessionStore } from "./sessionStore";

export function openRemotePlace(location: RemoteLocation, pane: LinkedPane, newTab = false) {
  const { hostId, path } = location;
  const session = getPaneSessionStore(pane).getState();
  const matches = (tab: typeof session.tabs[number]) =>
    tab.kind === "remote" && tab.remote.hostId === hostId && tab.remote.path === path;
  const existing = !newTab && (session.tabs.find(tab => tab.id === session.activeTabId && matches(tab)) ?? session.tabs.find(matches));
  if (existing) {
    session.setActiveTabId(existing.id);
    setBottomPaneActive(pane === "bottom");
  } else {
    openRemoteTab(hostId, path, pane);
  }
  // The open tab displays connection errors and offers Reconnect. Missing profiles
  // also get their own unavailable state, without substituting a different host.
  const profile = useRemoteHosts.getState().profiles.find(item => item.id === hostId);
  if (profile) void connectRemote(profile).catch(() => {});
}

export function remotePlaceSubtitle(path: string, profile?: RemoteProfile) {
  return `${profile?.name || profile?.destination || "Unavailable host"} · ${path}`;
}
