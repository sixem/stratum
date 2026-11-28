// SQLite owns recovery records. This projection is shared by Work and reconnect warnings.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { toMessage } from "@/lib/fsUtils";
import { remoteParent } from "@/lib/remotePaths";
import { remoteDirectoryChanged } from "./remoteDirectoryChanges";
import { usePromptStore } from "./promptStore";

export type RecoveryDetail = {
  id: string; kind: "move" | "delete" | "destination"; host: string;
  original: string | null; sourceHost: string | null; location: string; state: string;
};
export const useRecovery = create<{ details: RecoveryDetail[]; error: string }>(() => ({ details: [], error: "" }));
let generation = 0;
export async function refreshRecovery() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const request = ++generation;
  try {
    const details = await invoke<RecoveryDetail[]>("remote_recovery_details");
    if (request === generation) useRecovery.setState({ details, error: "" });
  } catch (error) {
    if (request === generation) useRecovery.setState({ error: toMessage(error, "Could not read the recovery journal.") });
  }
}

export async function acknowledgeRecovery({ id, kind, host, state }: RecoveryDetail) {
  try {
    await invoke("remote_recovery_acknowledge", { id, kind, host, state });
  } finally {
    await refreshRecovery();
  }
}

export async function checkInterruptedOperations(profileId: string, sessionId: number, host: string) {
  try {
    const { restored, warnings } = await invoke<{ restored: string[]; warnings: string[] }>(
      "remote_finish_interrupted_transfers", { profileId, sessionId });
    for (const path of restored) remoteDirectoryChanged({ profileId, sessionId, path: remoteParent(path) });
    if (warnings.length) usePromptStore.getState().showPrompt({
      title: `Interrupted operations on ${host}`, content: [...warnings, "Review remaining locations in Work."].join("\n\n"),
      confirmLabel: "Close", cancelLabel: null, queued: true, blocking: true,
    });
  } finally {
    await refreshRecovery();
  }
}
