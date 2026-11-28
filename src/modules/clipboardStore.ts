// The store mirrors Windows for menu availability and Cut highlighting. Paste
// always reads the system clipboard, including changes from other applications.
import { createWithEqualityFn } from "zustand/traditional";
import { getFileClipboard, setFileClipboard, setRemoteClipboard, setTextClipboard } from "@/api/clipboard";
import type { FileClipboard, FileClipboardMode } from "@/api/clipboard";
import { toMessage } from "@/lib/fsUtils";
import { usePromptStore } from "./promptStore";
import type { RemoteEntry } from "@/components/remote/remoteDirectory";
import { isRemoteClipboardCurrent } from "@/lib/remoteClipboardState";

export type RemoteClipboard = { profileId: string; host: string; path: string; entries: RemoteEntry[]; sequence: number; mode: FileClipboardMode };

// One clipboard sequence can have a move in flight across all panes.
export const activeCuts = new Set<number>();

export const useClipboardStore = createWithEqualityFn<{ clipboard: FileClipboard | null; remote: RemoteClipboard | null }>(() => ({
  clipboard: null,
  remote: null,
}));

let pendingWrite: Promise<void> | null = null;
let readGeneration = 0;

export const refreshFileClipboard = async () => {
  const generation = ++readGeneration;
  await pendingWrite;
  const selection = await getFileClipboard();
  if (generation === readGeneration) {
    const current = useClipboardStore.getState().clipboard;
    const next = selection.paths.length ? selection : null;
    if (current?.sequence !== next?.sequence || next?.sequence === 0) {
      useClipboardStore.setState({ clipboard: next });
    }
    const remote = useClipboardStore.getState().remote;
    if (remote && !isRemoteClipboardCurrent(remote.sequence, selection.sequence)) useClipboardStore.setState({ remote: null });
  }
  return selection;
};

const writeClipboard = async (publish: () => Promise<void>, errorTitle: string) => {
  // A quick Copy followed by Cut must leave Cut as the final Windows operation.
  readGeneration++;
  const write = (pendingWrite ?? Promise.resolve())
    .catch(() => {})
    .then(publish);
  pendingWrite = write;
  try {
    await write;
  } catch (error) {
    usePromptStore.getState().showPrompt({
      title: errorTitle,
      content: toMessage(error, "Windows could not update the clipboard."),
      confirmLabel: "OK",
      cancelLabel: null,
    });
    return;
  } finally {
    if (pendingWrite === write) pendingWrite = null;
  }
  if (!pendingWrite) await refreshFileClipboard().catch(() => {});
};

export const writeFileClipboard = async (paths: string[], mode: FileClipboardMode) => {
  if (!paths.length) return;
  await writeClipboard(
    () => setFileClipboard(paths, mode),
    mode === "move" ? "Couldn't cut items" : "Couldn't copy items",
  );
};

export const writeTextClipboard = async (text: string) => {
  if (!text) return;
  await writeClipboard(async () => { await setTextClipboard(text); }, "Couldn't copy text");
};

// Remote paths are text on the Windows clipboard, never fake local file paths.
// The sequence binds the in-app selection to that exact clipboard write.
export async function writeRemoteClipboard(input: Omit<RemoteClipboard, "sequence">, expectedSequence?: number) {
  if (!input.entries.length && expectedSequence === undefined) return;
  await writeClipboard(async () => {
    const text = input.entries.map(entry => `${input.host}:${entry.path}`).join("\r\n");
    const sequence = await setRemoteClipboard(text, crypto.randomUUID(), expectedSequence);
    if (!sequence && expectedSequence !== undefined) {
      if (useClipboardStore.getState().remote?.sequence === expectedSequence) useClipboardStore.setState({ remote: null });
      return;
    }
    if (!sequence) throw new Error("Windows did not provide a clipboard sequence.");
    useClipboardStore.setState({ remote: { ...input, entries: [...input.entries], sequence }, clipboard: null });
  }, expectedSequence !== undefined ? "Couldn't update the cut selection" : input.mode === "move" ? "Couldn't cut items" : "Couldn't copy items");
}

export async function readRemoteClipboard() {
  const selection = await refreshFileClipboard();
  const remote = useClipboardStore.getState().remote;
  return remote && isRemoteClipboardCurrent(remote.sequence, selection.sequence) ? remote : null;
}
