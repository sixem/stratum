// A restored tab can initiate its first connection. Explicit disconnects and failures require user input.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { connectRemote, useRemoteHosts } from "@/modules/remoteHosts";
import { toMessage } from "@/lib/fsUtils";
import type { RemoteEntry } from "./remoteDirectory";

type Listing = { path: string; sessionId: number; entries: RemoteEntry[]; omittedEntries: number };
type ListingResult = { request: string; data?: Listing; error?: string };

export function useRemoteListing(hostId: string, path: string, refreshVersion = 0) {
  const profile = useRemoteHosts(s => s.profiles.find(p => p.id === hostId));
  const connection = useRemoteHosts(s => s.connections[hostId]);
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<ListingResult | null>(null);
  const sessionId = connection?.status === "connected" ? connection.sessionId : undefined;
  const request = JSON.stringify([hostId, sessionId, path, generation, refreshVersion]);
  const refresh = () => setGeneration(value => value + 1);
  const reconnect = () => { if (profile) void connectRemote(profile).catch(() => {}); };
  useEffect(() => {
    if (profile && !connection) void connectRemote(profile).catch(() => {});
  }, [profile, connection]);
  useEffect(() => {
    if (sessionId === undefined) return;
    let current = true;
    invoke<Listing>("remote_list", { profileId: hostId, path, sessionId }).then(data => {
      if (current && data.sessionId === sessionId) setResult({ request, data });
    }, cause => {
      if (current) setResult({ request, error: toMessage(cause, "Could not read the remote folder.") });
    });
    return () => { current = false; };
  }, [hostId, path, request, sessionId]);
  const matching = result?.request === request ? result : null;
  return { profile, connection, sessionId, data: matching?.data, error: matching?.error, refresh, reconnect };
}
