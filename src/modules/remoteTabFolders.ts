// Resolve SFTP submenu rows in the session which will receive the drop.
import { invoke } from "@tauri-apps/api/core";
import { remoteParent } from "@/lib/remotePaths";
import type { DropTargetSubmenuItem } from "@/lib/dropTarget";
import type { RemoteEntry } from "@/components/remote/remoteDirectory";
import { connectRemote, useRemoteHosts } from "./remoteHosts";
import { useSettingsStore } from "./settings.store";

export async function listRemoteTabFolders(profileId: string, path: string, children: boolean, parent: boolean, signal: AbortSignal) {
  const profile = useRemoteHosts.getState().profiles.find(item => item.id === profileId);
  if (!profile) throw new Error("Host unavailable.");
  await connectRemote(profile, signal);
  signal.throwIfAborted();
  const sessionId = useRemoteHosts.getState().connections[profileId]?.sessionId;
  if (!sessionId) throw new Error("Host disconnected.");
  const remote = { profileId, sessionId };
  const items: DropTargetSubmenuItem[] = [];
  const listing = children ? await invoke<{ path: string; entries: RemoteEntry[] }>("remote_list", { ...remote, path }) : null;
  signal.throwIfAborted();
  if (listing) {
    const hidden = useSettingsStore.getState().remoteShowHidden;
    for (const entry of listing.entries) {
      if (entry.isDir && !entry.isSymlink && (hidden || !entry.name.startsWith("."))) items.push({ name: entry.name, path: entry.path });
    }
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  if (parent && path !== "/") {
    const displayed = remoteParent(path);
    let resolved = displayed;
    if (displayed !== "/" && listing?.path !== path) {
      const target = await invoke<{ path: string; kind: string }>("remote_resolve_target", { ...remote, path: displayed });
      if (target.kind !== "directory") throw new Error("The parent folder changed.");
      resolved = target.path;
    }
    items.unshift({ path: resolved, name: displayed.split("/").pop() || "/", parent: true });
  }
  if (useRemoteHosts.getState().connections[profileId]?.sessionId !== sessionId) throw new Error("Host disconnected.");
  return { remote, items };
}
