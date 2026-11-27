// Resolve a copied remote selection when it is pasted into a local folder.
import { readRemoteClipboard, refreshFileClipboard, type RemoteClipboard } from "./clipboardStore";
import { connectRemote, useRemoteHosts } from "./remoteHosts";
import { copyRemoteFiles } from "./remoteTransfer";

export async function pasteRemoteClipboardToLocal(destination: string, selected?: RemoteClipboard) {
  const clipboard = selected ?? await readRemoteClipboard();
  if (!clipboard) return false;
  const profile = useRemoteHosts.getState().profiles.find(item => item.id === clipboard.profileId);
  if (!profile || profile.destination !== clipboard.host) throw new Error("The copied host is no longer available. Copy the items again.");
  await connectRemote(profile);
  const sessionId = useRemoteHosts.getState().connections[profile.id]?.sessionId;
  if (!sessionId) throw new Error("The copied host is disconnected.");
  await copyRemoteFiles(clipboard.entries.map(entry => entry.path), { profileId: profile.id, sessionId, path: clipboard.path }, destination, "download", false, undefined,
    new Map(clipboard.entries.map(entry => [entry.path, entry])));
  return true;
}

export async function pasteIntoRemote(destination: { profileId: string; sessionId: number; path: string }) {
  const copied = await readRemoteClipboard();
  if (copied) {
    const profile = useRemoteHosts.getState().profiles.find(item => item.id === copied.profileId);
    if (!profile || profile.destination !== copied.host) throw new Error("The copied host is no longer available. Copy the items again.");
    await connectRemote(profile);
    const sessionId = useRemoteHosts.getState().connections[profile.id]?.sessionId;
    if (!sessionId) throw new Error("The copied host is disconnected.");
    await copyRemoteFiles(copied.entries.map(entry => entry.path), { profileId: profile.id, sessionId, path: copied.path }, "", "download", false, destination,
      new Map(copied.entries.map(entry => [entry.path, entry])));
    return;
  }
  const local = await refreshFileClipboard();
  if (!local.paths.length) return;
  if (local.mode === "move") throw new Error("Use drag and drop to move local files into a remote folder.");
  await copyRemoteFiles(local.paths, destination, "", "upload");
}
