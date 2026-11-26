// Remote paths are case sensitive; preserve their exact spelling through tab history.
import type { RemoteTab } from "@/types/tabs";

import { jumpThroughTabHistory } from "../hooks/domain/session/tabHistoryStacks.ts";

import { resolveCrumbTrailPath } from "./crumbTrail.ts";

export function navigateRemoteTab(tab: RemoteTab, destination: { path: string } | "back" | "forward", offset = 0, expectedPath?: string): RemoteTab {
  const { back = [], forward = [] } = tab.remoteHistory ?? {};
  const from = tab.remote.path;
  const remoteHistory = { back: [...back], forward: [...forward] };
  const path = typeof destination === "object" ? destination.path
    : jumpThroughTabHistory(remoteHistory, destination, from, offset, 40, expectedPath);
  if (!path?.startsWith("/") || path === from) return tab;
  if (typeof destination === "object") {
    remoteHistory.back = [...back.slice(-39), from];
    remoteHistory.forward = [];
  }
  return { ...tab, remote: { ...tab.remote, path }, remoteHistory, scrollTop: 0,
    crumbTrailPath: resolveCrumbTrailPath(path, tab.crumbTrailPath || from, true) };
}
