// The store mirrors Windows for menu availability and Cut highlighting. Paste
// always reads the system clipboard, including changes from other applications.
import { createWithEqualityFn } from "zustand/traditional";
import { getFileClipboard, setFileClipboard } from "@/api/clipboard";
import type { FileClipboard, FileClipboardMode } from "@/api/clipboard";
import { toMessage } from "@/lib/fsUtils";
import { usePromptStore } from "./promptStore";

export const useClipboardStore = createWithEqualityFn<{ clipboard: FileClipboard | null }>(() => ({
  clipboard: null,
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
  }
  return selection;
};

export const writeFileClipboard = async (paths: string[], mode: FileClipboardMode) => {
  if (!paths.length) return;
  // A quick Copy followed by Cut must leave Cut as the final Windows operation.
  readGeneration++;
  const write = (pendingWrite ?? Promise.resolve())
    .catch(() => {})
    .then(() => setFileClipboard(paths, mode));
  pendingWrite = write;
  try {
    await write;
  } catch (error) {
    usePromptStore.getState().showPrompt({
      title: mode === "move" ? "Couldn't cut items" : "Couldn't copy items",
      content: toMessage(error, "Windows could not update the file clipboard."),
      confirmLabel: "OK",
      cancelLabel: null,
    });
    return;
  } finally {
    if (pendingWrite === write) pendingWrite = null;
  }
  if (!pendingWrite) await refreshFileClipboard().catch(() => {});
};
