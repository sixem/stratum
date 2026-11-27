// Queue same-host renames together so Work can pause or cancel between items.
import { invoke } from "@tauri-apps/api/core";
import { isTransferCancelledError, getTransferErrorMessage } from "@/hooks/domain/filesystem/transferJobErrors";
import { usePromptStore } from "@/modules/promptStore";
import { useTransferStore } from "@/modules/transferStore";
import { refreshRemoteTransferDirectory } from "@/modules/remoteTransferRefresh";
import type { RemoteEntry } from "./remoteDirectory";

export async function moveRemoteEntries(entries: RemoteEntry[], profileId: string, sessionId: number, parent: string, destination: string) {
  if (!entries.length) return;
  const registration = useTransferStore.getState().registerJob({ label: "Move remote items", items: entries.map(entry => entry.path) });
  try {
    await invoke("remote_transfer_file", { profileId, sessionId, transferId: registration.id, moving: true,
      request: { kind: "rename", parent, destination, entries } });
    useTransferStore.getState().recordJobOutcome(registration.id, { moved: entries.length });
  } catch (error) {
    if (!isTransferCancelledError(error)) {
      useTransferStore.getState().recordJobOutcome(registration.id, { failures: 1 });
      usePromptStore.getState().showPrompt({ title: "Some items could not be moved",
        content: getTransferErrorMessage(error, "Could not move the selected items."), confirmLabel: "OK", cancelLabel: null });
    }
  } finally {
    refreshRemoteTransferDirectory({ profileId, sessionId, path: parent });
    refreshRemoteTransferDirectory({ profileId, sessionId, path: destination });
  }
}
