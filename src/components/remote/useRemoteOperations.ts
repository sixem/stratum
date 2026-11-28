// Operations shared by the list, grid, empty state, and context menus.
import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { refreshRecovery } from "@/modules/remoteRecovery";
import { usePromptStore } from "@/modules/promptStore";
import { useTransferStore } from "@/modules/transferStore";
import { useBatchRenameStore } from "@/modules/batchRenameStore";
import { getPaneDirectory } from "@/hooks/ui/menus/usePaneTransferTarget";
import type { LinkedPane } from "@/lib/paneLink";
import type { BatchRenameRequest } from "@/lib/batchRename";
import type { RenameCommitReason } from "@/types";
import type { RemoteEntry } from "./remoteDirectory";
import { remoteDirectoryChanged } from "./remoteChanges";
import { getTransferErrorMessage, isTransferCancelledError } from "@/hooks/domain/filesystem/transferJobErrors";

function showError(title: string, error: unknown) {
  usePromptStore.getState().showPrompt({ title, content: String(error), confirmLabel: "OK", cancelLabel: null });
}

export function useRemoteOperations(profileId: string, sessionId: number, parent: string, onDeleted: () => void, pane: LinkedPane) {
  const [target, setTarget] = useState<RemoteEntry | null>(null);
  const [value, setValue] = useState("");
  const changed = useCallback((path: string) => remoteDirectoryChanged({ profileId, sessionId, path }), [profileId, sessionId]);
  const create = useCallback(async (folder: string, name: string, directory: boolean) => {
    try {
      await invoke("remote_create_entry", { profileId, sessionId, parent: folder, name, directory });
      changed(folder);
      return true;
    } catch (error) { showError("Could not create item", error); return false; }
  }, [profileId, sessionId, changed]);
  const startRename = useCallback((entry: RemoteEntry) => { setTarget(entry); setValue(entry.name); }, []);
  const startBatchRename = useCallback((entries: RemoteEntry[]) => {
    if (entries.length < 2 || entries.length > 256) {
      if (entries.length > 256) showError("Too many items", "Rename up to 256 remote items at a time.");
      return;
    }
    const byPath = new Map(entries.map(entry => [entry.path, entry]));
    const checkPane = () => {
      const current = getPaneDirectory(pane);
      if (!current || current.kind !== "remote" || current.profileId !== profileId || current.sessionId !== sessionId || current.path !== parent)
        throw new Error("The original remote folder is no longer open in this pane.");
    };
    const validate = async (requests: BatchRenameRequest[]) => {
      checkPane();
      const listing = await invoke<{ path: string; entries: RemoteEntry[] }>("remote_list", { profileId, sessionId, path: parent });
      if (listing.path !== parent) throw new Error("The remote folder changed. Refresh and try again.");
      const current = new Map(listing.entries.map(entry => [entry.name, entry]));
      const errors = new Map<string, string>();
      for (const request of requests) {
        const expected = byPath.get(request.path);
        const actual = expected && current.get(expected.name);
        if (!expected || !actual || Boolean(actual.isSymlink) !== Boolean(expected.isSymlink) ||
          (!expected.isSymlink && actual.isDir !== expected.isDir) || actual.size !== expected.size || actual.modified !== expected.modified)
          errors.set(request.path, "The item changed. Refresh and try again.");
        else if (current.has(request.nextName)) errors.set(request.path, "An item with this name already exists.");
      }
      return errors;
    };
    useBatchRenameStore.getState().open({ items: entries, remote: true, onValidate: validate,
      onApply: async requests => {
        const operationId = crypto.randomUUID();
        let done = 0;
        try {
          for (const request of requests) {
            checkPane();
            const entry = byPath.get(request.path);
            if (!entry) throw new Error("An item is no longer in the selection.");
            await invoke("remote_rename_entry", { profileId, sessionId, parent, entry, name: request.nextName, operationId });
            done++;
          }
        } catch (error) {
          throw new Error(`${done} of ${requests.length} items renamed. ${String(error)}`);
        } finally {
          if (done) changed(parent);
        }
      },
    });
  }, [profileId, sessionId, parent, pane, changed]);
  const cancelRename = useCallback(() => setTarget(null), []);
  const commitRename = useCallback((_reason: RenameCommitReason) => {
    const entry = target, name = value;
    setTarget(null);
    if (!entry || !name || name === entry.name) return;
    void invoke("remote_rename_entry", { profileId, sessionId, parent, entry, name })
      .then(() => changed(parent))
      .catch(error => showError("Could not rename item", error));
  }, [target, value, profileId, sessionId, parent, changed]);
  const deleteEntries = useCallback((entries: RemoteEntry[]) => {
    if (!entries.length) return;
    const label = entries.length === 1 ? entries[0].name : `${entries.length} items`;
    usePromptStore.getState().showPrompt({
      title: "Delete permanently?",
      content: `Delete ${label} from the remote host? This cannot be undone.`,
      confirmLabel: "Delete", cancelLabel: "Cancel",
      onConfirm: () => { void (async () => {
        const work = useTransferStore.getState();
        const job = work.registerJob({ label: "Delete remote items", items: entries.map(entry => entry.path) });
        try {
          const report = await invoke<{ deleted: number; cancelled: boolean; failures: string[] }>("remote_delete_entries", {
            profileId, sessionId, parent, entries, transferId: job.id,
          });
          work.recordJobOutcome(job.id, { failures: report.failures.length });
          if (report.deleted) onDeleted();
          if (report.failures.length) showError("Some items could not be deleted", report.failures.join("\n"));
        } catch (error) {
          if (!isTransferCancelledError(error)) {
            work.recordJobOutcome(job.id, { failures: 1 });
            showError("Could not delete items", getTransferErrorMessage(error, "Could not delete the selected items."));
          }
        } finally {
          changed(parent);
          void refreshRecovery();
        }
      })(); },
    });
  }, [profileId, sessionId, parent, changed, onDeleted]);
  return { create, startRename, startBatchRename, cancelRename, commitRename, target, value, setValue, deleteEntries };
}
