import { useState } from "react";
import type { RemoteTab } from "@/types/tabs";
import type { LinkedPane } from "@/lib/paneLink";
import { navigateRemoteTab } from "@/lib/remoteNavigation";
import { openRemoteTab, updateRemoteTab } from "@/modules/remoteTabs";
import { useRemoteHosts } from "@/modules/remoteHosts";
import { getNextTrailPath } from "@/lib/pathCrumbs";
import { remoteParent } from "./remoteDirectory";

export function useRemoteNavigation(tab: RemoteTab | null, pane: LinkedPane) {
  const host = useRemoteHosts(s => tab && s.profiles.find(p => p.id === tab.remote.hostId)?.name);
  const key = JSON.stringify([tab?.id, tab?.remote.path]);
  const [draft, setDraft] = useState({ key: "", path: "" });
  const change = (fn: (current: RemoteTab) => RemoteTab) => {
    if (tab) updateRemoteTab(pane, tab.id, fn);
  };
  const navigate = (path: string) => change(current => navigateRemoteTab(current, { path }));
  const path = draft.key === key ? draft.path : tab?.remote.path ?? "";
  const down = tab ? getNextTrailPath(tab.remote.path, tab.crumbTrailPath, host || "Remote") : null;
  return {
    host: host || "Remote", path, navigate,
    setPath: (path: string) => setDraft({ key, path }),
    submit: () => { navigate(path); setDraft({ key: "", path: "" }); },
    openTab: (path: string) => { if (tab) openRemoteTab(tab.remote.hostId, path, pane); },
    setSearch: (search: string) => change(current => ({ ...current, search, scrollTop: 0 })),
    refresh: () => change(current => ({ ...current, refreshVersion: (current.refreshVersion ?? 0) + 1 })),
    steps: {
      canGoBack: !!tab?.remoteHistory?.back.length, canGoForward: !!tab?.remoteHistory?.forward.length,
      canGoUp: !!tab && tab.remote.path !== "/", canGoDown: !!down,
      onBack: () => change(current => navigateRemoteTab(current, "back")),
      onForward: () => change(current => navigateRemoteTab(current, "forward")),
      onUp: () => { if (tab) navigate(remoteParent(tab.remote.path)); },
      onDown: () => { if (down) navigate(down); },
    },
  };
}
