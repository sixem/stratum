// A restored tab can initiate its first connection. Explicit disconnects and failures require user input.
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { connectRemote, useRemoteHosts } from "@/modules/remoteHosts";
import { toMessage } from "@/lib/fsUtils";
import type { RemoteEntry } from "./remoteDirectory";
import { selectRemoteListing, type RemoteListingResult } from "./remoteListingState";
import { RemoteViewCache } from "./remoteViewCache";

type Listing = { path: string; sessionId: number; entries: RemoteEntry[]; omittedEntries: number };
const listings = new RemoteViewCache<Listing>(64, 16 * 1024 * 1024);

export function useRemoteListing(hostId: string, path: string, refreshVersion = 0) {
  const profile = useRemoteHosts(s => s.profiles.find(p => p.id === hostId));
  const connection = useRemoteHosts(s => s.connections[hostId]);
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<RemoteListingResult<Listing> | null>(null);
  const sessionId = connection?.status === "connected" ? connection.sessionId : undefined;
  const location = JSON.stringify([hostId, sessionId, connection?.epoch, path]);
  const request = JSON.stringify([location, generation, refreshVersion]);
  const refresh = useCallback(() => setGeneration(value => value + 1), []);
  const reconnect = () => { if (profile) void connectRemote(profile).catch(() => {}); };
  useEffect(() => {
    if (profile && !connection) void connectRemote(profile).catch(() => {});
  }, [profile, connection]);
  useEffect(() => {
    if (sessionId === undefined) return;
    let current = true;
    invoke<Listing>("remote_list", { profileId: hostId, path, sessionId }).then(data => {
      if (current && data.sessionId === sessionId) {
        const estimatedBytes = data.entries.reduce((bytes, entry) => bytes + 128 + 2 * (entry.name.length + entry.path.length), 128);
        listings.set(location, data, estimatedBytes);
        setResult({ location, request, data });
      }
    }, cause => {
      if (current) { listings.delete(location); setResult({ location, request, error: toMessage(cause, "Could not read the remote folder.") }); }
    });
    return () => { current = false; };
  }, [hostId, path, location, request, sessionId]);
  // Reuse only the same host, connection and path; revalidate on every visit.
  const visible = selectRemoteListing(result, location, request);
  const cached = sessionId !== undefined && !visible.error ? listings.get(location) : undefined;
  return { profile, connection, sessionId, ...visible, data: visible.data ?? cached, refresh, reconnect };
}
