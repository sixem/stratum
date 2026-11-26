// Only the SSH destination, display name, and starting folder are persisted.
export type RemoteProfile = {
  id: string;
  destination: string;
  name: string;
  startPath: string;
};

const STORAGE_KEY = "stratum.remoteHosts";

export function loadRemoteProfiles(): RemoteProfile[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const profiles: RemoteProfile[] = [];
    const ids = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item.id !== "string" || !/^[\da-f-]{36}$/i.test(item.id)
        || ids.has(item.id) || typeof item.destination !== "string" || !item.destination
        || typeof item.name !== "string" || typeof item.startPath !== "string") continue;
      const { id, destination, name, startPath } = item;
      profiles.push({ id, destination, name, startPath });
      ids.add(id);
    }
    return profiles;
  } catch {
    return [];
  }
}

export function writeRemoteProfiles(profiles: RemoteProfile[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}
