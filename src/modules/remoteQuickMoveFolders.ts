// Derive destinations from this workspace's tab sessions. Only connected hosts are eligible.
import { useMemo } from "react";
import { useRemoteHosts, type RemoteConnection } from "./remoteHosts";
import { useBottomSessionStore, useSessionStore } from "./sessionStore";

export type RemoteMoveLocation = { profileId: string; sessionId: number; epoch: number; path: string };
export type RemoteQuickMoveFolder = RemoteMoveLocation & { host: string; hostName: string };

export const hasConnectedHost = (state: { connections: Record<string, RemoteConnection | undefined> }) =>
  Object.values(state.connections).some(connection => connection?.status === "connected");

export function currentMoveSession(location: RemoteMoveLocation) {
  const connection = useRemoteHosts.getState().connections[location.profileId];
  return connection?.status === "connected" && connection.epoch === location.epoch && connection.sessionId === location.sessionId;
}

export function useRemoteQuickMoveFolders() {
  const main = useSessionStore(state => state.tabs);
  const bottom = useBottomSessionStore(state => state.tabs);
  const closedMain = useSessionStore(state => state.closedTabs);
  const closedBottom = useBottomSessionStore(state => state.closedTabs);
  const profiles = useRemoteHosts(state => state.profiles);
  const connections = useRemoteHosts(state => state.connections);

  return useMemo(() => {
    const folders = new Map<string, RemoteQuickMoveFolder>();
    const hosts = new Map(profiles.map(profile => [profile.id, profile]));
    const add = (profileId: string, path: string) => {
      const connection = connections[profileId];
      const profile = hosts.get(profileId);
      if (!profile || connection?.status !== "connected" || connection.sessionId === undefined || !path.startsWith("/")) return;
      const key = JSON.stringify([profileId, path]);
      if (!folders.has(key)) folders.set(key, { path, profileId, epoch: connection.epoch, sessionId: connection.sessionId,
        host: profile.destination, hostName: profile.name });
    };
    const open = [...main, ...bottom];
    const closed = [...closedMain, ...closedBottom].map(item => item.tab);
    for (const tab of open) if (tab.kind === "remote") add(tab.remote.hostId, tab.remote.path);
    for (const tab of [...open, ...closed]) {
      if (tab.kind !== "remote") continue;
      add(tab.remote.hostId, tab.remote.path);
      for (const history of [tab.remoteHistory?.back, tab.remoteHistory?.forward]) {
        if (history) for (let i = history.length - 1; i >= 0; i--) add(tab.remote.hostId, history[i]);
      }
    }
    for (const profile of profiles) {
      const home = connections[profile.id]?.path;
      if (home) add(profile.id, home);
    }
    return [...folders.values()];
  }, [main, bottom, closedMain, closedBottom, connections, profiles]);
}
