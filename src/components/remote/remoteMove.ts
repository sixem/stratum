// Queue same-host renames together so Work can pause or cancel between items.
import { invoke } from "@tauri-apps/api/core";
import { isTransferCancelledError, getTransferErrorMessage } from "@/hooks/domain/filesystem/transferJobErrors";
import { usePromptStore } from "@/modules/promptStore";
import { useTransferStore } from "@/modules/transferStore";
import { refreshRemoteTransferDirectory } from "@/modules/remoteTransferRefresh";
import type { RemoteEntry } from "./remoteDirectory";

export async function moveRemoteEntries(entries: RemoteEntry[], profileId: string, sessionId: number, parent: string, destination: string, transferId?: string) {
  if (!entries.length) return;
  const registration = useTransferStore.getState().registerJob({ id: transferId, label: "Move remote items", items: entries.map(entry => entry.path) });
  try {
    const report = await invoke<{ items: { index: number; result: unknown | null; error: string | null }[]; cancelled: boolean }>("remote_transfer_file", { profileId, sessionId, transferId: registration.id,
      request: { kind: "rename", parent, destination, entries } });
    const moved = report.items.filter(item => item.result).length;
    const failures = report.items.filter(item => item.error);
    useTransferStore.getState().recordJobOutcome(registration.id, { moved, failures: failures.length });
    if (failures.length) usePromptStore.getState().showPrompt({ title: "Some items could not be moved",
      content: failures.map(item => `${entries[item.index]?.name ?? "Item"}: ${item.error}`).join("\n"), confirmLabel: "OK", cancelLabel: null });
  } catch (error) {
    if (transferId) useTransferStore.getState().failJob(transferId);
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
