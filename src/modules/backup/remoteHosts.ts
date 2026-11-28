// Map remote tab references together with the host profiles they depend on.
import type { RemoteProfile } from "../remoteProfiles";
import type { WorkspaceLayout } from "../workspaceStore";
import type { StratumBackup } from "./types";

export const UNLINKED_REMOTE_HOST = "unlinked";
export type BackupHostMappings = Readonly<Record<string, string>>;

const mapLayoutHosts = (layout: WorkspaceLayout, map: (id: string) => string): WorkspaceLayout => {
  const mapSession = (session: WorkspaceLayout["main"]) => ({
    ...session,
    tabs: session.tabs.map(tab => tab.kind === "remote"
      ? { ...tab, remote: { ...tab.remote, hostId: map(tab.remote.hostId) } }
      : tab),
  });
  return { ...layout, main: mapSession(layout.main), bottom: mapSession(layout.bottom),
    places: { ...layout.places, places: layout.places.places.map(place =>
      place.hostId ? { ...place, hostId: map(place.hostId) } : place) } };
};

export const mapBackupRemoteHosts = (backup: StratumBackup, map: (id: string) => string): StratumBackup => {
  const workspaces = backup.workspaces.map(workspace => ({
    ...workspace,
    layout: mapLayoutHosts(workspace.layout, map),
    draft: workspace.draft && mapLayoutHosts(workspace.draft, map),
  }));
  if (backup.scope === "workspaces") return { ...backup, workspaces };
  const { profile } = backup;
  return { ...backup, workspaces, profile: {
    ...profile,
    current: { ...profile.current, layout: mapLayoutHosts(profile.current.layout, map) },
    previous: profile.previous && { ...profile.previous, layout: mapLayoutHosts(profile.previous.layout, map) },
  } };
};

export const listBackupRemoteHostIds = (backup: StratumBackup): string[] => {
  const ids = new Set<string>();
  mapBackupRemoteHosts(backup, id => { ids.add(id); return id; });
  return [...ids];
};

export const selectBackupRemoteHosts = (backup: StratumBackup, profiles: readonly RemoteProfile[]): RemoteProfile[] => {
  const copyPortableDetails = ({ id, destination, name, startPath }: RemoteProfile): RemoteProfile => ({ id, destination, name, startPath });
  if (backup.scope === "full") return profiles.map(copyPortableDetails);
  const referenced = new Set(listBackupRemoteHostIds(backup));
  return profiles.filter(profile => referenced.has(profile.id)).map(copyPortableDetails);
};

// Existing profiles are never overwritten. Match the exact SSH destination,
// allocate new IDs on collisions, and require an explicit choice for old
// backups that have tab IDs but no host details.
export const planBackupRemoteHosts = (
  backup: StratumBackup,
  existing: readonly RemoteProfile[],
  choices: BackupHostMappings = {},
  createId: () => string = () => globalThis.crypto.randomUUID(),
) => {
  const incoming = backup.remoteHosts ?? [];
  const incomingById = new Map(incoming.map(host => [host.id, host]));
  const references = listBackupRemoteHostIds(backup);
  const referenced = new Set(references);
  const existingById = new Map(existing.map(host => [host.id, host]));
  const byDestination = new Map(existing.map(host => [host.destination, host]));
  const ids = new Set([...existing.map(host => host.id), ...incoming.map(host => host.id), ...references]);
  const freshId = () => {
    let id = createId();
    while (ids.has(id)) id = createId();
    ids.add(id);
    return id;
  };
  const profiles = [...existing];
  const mapped = new Map<string, string>();
  const missing: string[] = [];
  for (const id of new Set([...incoming.map(host => host.id), ...references])) {
    const choice = Object.prototype.hasOwnProperty.call(choices, id) ? choices[id] : undefined;
    const host = incomingById.get(id);
    if (choice && choice !== UNLINKED_REMOTE_HOST) {
      const selected = existingById.get(choice);
      if (!selected) throw new Error("A selected remote host is no longer available. Review the host mappings.");
      mapped.set(id, selected.id);
    } else if (choice === UNLINKED_REMOTE_HOST || !host) {
      mapped.set(id, freshId());
      if (referenced.has(id)) missing.push(id);
    } else {
      const sameDestination = byDestination.get(host.destination);
      if (sameDestination) mapped.set(id, sameDestination.id);
      else {
        const nextId = existingById.has(id) ? freshId() : id;
        const added = { ...host, id: nextId };
        profiles.push(added);
        byDestination.set(added.destination, added);
        mapped.set(id, nextId);
      }
    }
  }
  return { profiles, mapped, missing, backup: mapBackupRemoteHosts(backup, id => mapped.get(id) ?? id) };
};
