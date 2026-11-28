// Paste uses the same managed transfers as dragging files between panes.
import { finishFileCut } from "@/api/clipboard";
import { activeCuts, readRemoteClipboard, refreshFileClipboard, useClipboardStore, writeRemoteClipboard, type RemoteClipboard } from "./clipboardStore";
import { connectRemote, useRemoteHosts } from "./remoteHosts";
import { copyRemoteFiles, transferRemoteSelection } from "./remoteTransfer";

type RemoteFolder = { profileId: string; sessionId: number; path: string };

async function pasteRemoteSelection(clipboard: RemoteClipboard, destination: string | RemoteFolder) {
  const { entries, profileId, host, path, sequence } = clipboard;
  const moving = clipboard.mode === "move";
  if (moving && activeCuts.has(sequence)) return;
  if (moving) activeCuts.add(sequence);
  try {
    const profile = useRemoteHosts.getState().profiles.find(item => item.id === profileId);
    if (!profile || profile.destination !== host) throw new Error("The source host changed. Select the items again.");
    await connectRemote(profile);
    const sessionId = useRemoteHosts.getState().connections[profileId]?.sessionId;
    if (!sessionId) throw new Error("The source host is disconnected.");
    const moved = await transferRemoteSelection(entries, { profileId, sessionId, path }, destination, moving);
    if (moved.length && useClipboardStore.getState().remote === clipboard) {
      const consumed = new Set(moved);
      const remaining = { ...clipboard, entries: entries.filter(entry => !consumed.has(entry.path)) };
      // Even if Windows refuses a clipboard write, consumed paths cannot move twice.
      useClipboardStore.setState({ remote: remaining.entries.length ? remaining : null });
      await writeRemoteClipboard(remaining, sequence);
    }
  } finally {
    if (moving) activeCuts.delete(sequence);
  }
}

export async function pasteRemoteClipboardToLocal(destination: string, selected?: RemoteClipboard) {
  const clipboard = selected ?? await readRemoteClipboard();
  if (!clipboard) return false;
  await pasteRemoteSelection(clipboard, destination);
  return true;
}

export async function pasteIntoRemote(destination: RemoteFolder) {
  const remote = await readRemoteClipboard();
  if (remote) return pasteRemoteSelection(remote, destination);
  const local = await refreshFileClipboard();
  if (!local.paths.length) return;
  if (local.mode !== "move") { await copyRemoteFiles(local.paths, destination, "", "upload"); return; }
  if (activeCuts.has(local.sequence)) return;
  activeCuts.add(local.sequence);
  try {
    const moved = await copyRemoteFiles(local.paths, destination, "", "upload", true);
    if (moved.length) {
      await finishFileCut(local.sequence, moved);
      await refreshFileClipboard();
    }
  } finally {
    activeCuts.delete(local.sequence);
  }
}
