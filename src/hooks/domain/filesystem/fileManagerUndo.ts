// Handles undo stack operations for delete, rename, and move actions.
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { removeCreatedFolderIfEmpty, restoreRecycleItems, statEntries, transferEntries } from "@/api";
import type { CreatedFolder } from "@/types/fs";
import { entryExists, formatFailures, getParentPath, toMessage } from "@/lib";
import { usePromptStore } from "@/modules";
import type { RenameRequest } from "./fileManager.types";
import { isTransferCancelledError } from "./transferJobErrors";

type UndoFileEntry = {
  from: string;
  to: string;
  identity: string;
};

export type UndoRenameEntry = UndoFileEntry;
export type UndoMoveEntry = UndoFileEntry;

export type UndoTrashEntry = {
  originalPath: string;
  trashPath: string;
  identity: string;
};

export type UndoAction =
  | { type: "rename"; entries: UndoRenameEntry[] }
  | { type: "move"; entries: UndoMoveEntry[]; createdFolder?: CreatedFolder }
  | { type: "trash"; entries: UndoTrashEntry[] }
  | { type: "recycle"; receiptId: string };

type RenameBatchResult = {
  renamed: Map<string, string>;
};

type UseFileManagerUndoOptions = {
  undoStackRef: RefObject<UndoAction[]>;
  renameInFlightRef: RefObject<boolean>;
  deleteInFlightRef: RefObject<boolean>;
  copyInFlightRef: RefObject<boolean>;
  transferInFlightRef: RefObject<boolean>;
  onRenameUndoPresence?: (suppress: boolean) => void;
  onDirectoryChildrenChanged?: (paths: string[]) => void;
  performRenameRequests: (
    renames: RenameRequest[],
    options?: { recordUndo?: boolean; failureTitle?: string },
  ) => Promise<RenameBatchResult | null>;
  refreshAfterChange: () => Promise<void>;
};

type RestoreGroup = { path: string; identity: string }[];

// Stop on cancellation and keep earlier groups' committed restores on any failure.
const restoreGroups = async (grouped: Map<string, RestoreGroup>, failures: string[], protectedFolder?: CreatedFolder) => {
  const restoredPaths = new Set<string>();
  for (const [destination, entries] of grouped) {
    try {
      const report = await transferEntries(entries.map((entry) => entry.path), destination, {
        mode: "move",
        overwrite: false,
        protectedFolder,
        expectedSources: Object.fromEntries(entries.map((entry) => [entry.path, entry.identity])),
      });
      for (const entry of report.movedEntries) restoredPaths.add(entry.sourcePath);
      failures.push(...report.failures);
      if (report.cancelled) break;
    } catch (error) {
      // Queued and planning jobs can be cancelled before an execution report exists.
      if (isTransferCancelledError(error)) break;
      failures.push(`${destination}: ${toMessage(error, "Unable to restore the moved items.")}`);
    }
  }
  return restoredPaths;
};

export const useFileManagerUndo = ({
  undoStackRef,
  renameInFlightRef,
  deleteInFlightRef,
  copyInFlightRef,
  transferInFlightRef,
  onRenameUndoPresence,
  onDirectoryChildrenChanged,
  performRenameRequests,
  refreshAfterChange,
}: UseFileManagerUndoOptions) => {
  const undoInFlight = useRef(false);
  const restoreMovedEntries = useCallback(
    async (entries: UndoMoveEntry[], createdFolder?: CreatedFolder) => {
      if (entries.length === 0) {
        return { restored: 0, remaining: [] as UndoMoveEntry[] };
      }

      const currentPaths = entries.map((entry) => entry.to);
      const currentMeta = await statEntries(currentPaths);
      const existingDestinations = await statEntries(entries.map((entry) => entry.from));
      const grouped = new Map<string, RestoreGroup>();
      const failures: string[] = [];

      entries.forEach((entry, index) => {
        if (!entry.from || !entry.to) return;
        if (!entryExists(currentMeta[index])) {
          failures.push(`${entry.to}: item no longer exists`);
          return;
        }
        if (entryExists(existingDestinations[index])) {
          failures.push(`${entry.from}: destination already exists`);
          return;
        }
        const destination = getParentPath(entry.from);
        if (!destination) {
          failures.push(`${entry.from}: missing parent folder`);
          return;
        }
        const list = grouped.get(destination) ?? [];
        list.push({ path: entry.to, identity: entry.identity });
        grouped.set(destination, list);
      });

      const restoredPaths = await restoreGroups(grouped, failures, createdFolder);
      const restored = restoredPaths.size;

      // Keep requests that might be retried without re-reading paths already settled.
      const remaining = entries.filter((entry, index) =>
        !restoredPaths.has(entry.to) && entryExists(currentMeta[index]),
      );

      if (failures.length > 0) {
        usePromptStore.getState().showPrompt({
          title: "Undo completed with issues",
          content: formatFailures(failures),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      }

      if (restored > 0) {
        if (!createdFolder) await refreshAfterChange();
        onDirectoryChildrenChanged?.(
          entries
            .flatMap((entry) => [getParentPath(entry.from) ?? "", getParentPath(entry.to) ?? ""])
            .filter(Boolean),
        );
      }

      return { restored, remaining };
    },
    [onDirectoryChildrenChanged, refreshAfterChange],
  );

  const restoreTrashedEntries = useCallback(
    async (entries: UndoTrashEntry[]) => {
      if (entries.length === 0) {
        return { restored: 0, remaining: [] };
      }
      const originals = entries.map((entry) => entry.originalPath);
      const existingMeta = await statEntries(originals);
      const existing = new Set<string>();
      existingMeta.forEach((meta, index) => {
        if (entryExists(meta)) {
          existing.add(originals[index] ?? "");
        }
      });

      const grouped = new Map<string, RestoreGroup>();
      const failures: string[] = [];
      entries.forEach((entry) => {
        if (!entry.originalPath || !entry.trashPath) return;
        if (existing.has(entry.originalPath)) {
          failures.push(`${entry.originalPath}: destination already exists`);
          return;
        }
        const parent = getParentPath(entry.originalPath);
        if (!parent) {
          failures.push(`${entry.originalPath}: missing parent folder`);
          return;
        }
        const list = grouped.get(parent) ?? [];
        list.push({ path: entry.trashPath, identity: entry.identity });
        grouped.set(parent, list);
      });

      const restoredPaths = await restoreGroups(grouped, failures);
      const restored = restoredPaths.size;

      const pending = entries.filter((entry) => !restoredPaths.has(entry.trashPath));
      const trashMeta = await statEntries(pending.map((entry) => entry.trashPath));
      const remaining = pending.filter((_, index) => entryExists(trashMeta[index]));

      if (failures.length > 0) {
        usePromptStore.getState().showPrompt({
          title: "Undo completed with issues",
          content: formatFailures(failures),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      }

      if (restored > 0) {
        await refreshAfterChange();
        onDirectoryChildrenChanged?.(
          entries.map((entry) => getParentPath(entry.originalPath) ?? "").filter(Boolean),
        );
      }

      return { restored, remaining };
    },
    [refreshAfterChange],
  );

  const restoreRecycledItems = useCallback(
    async (receiptId: string) => {
      let report = null;
      try {
        report = await restoreRecycleItems(receiptId);
      } catch (error) {
        usePromptStore.getState().showPrompt({
          title: "Undo failed",
          content: toMessage(error, "Failed to restore deleted items."),
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return { restored: 0, canRetry: true };
      }
      if (report.failures.length > 0) {
        usePromptStore.getState().showPrompt({
          title: "Undo completed with issues",
          content: formatFailures(report.failures),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      }
      if (report.restoredPaths.length > 0) {
        await refreshAfterChange();
        onDirectoryChildrenChanged?.(
          report.restoredPaths.map((path) => getParentPath(path) ?? "").filter(Boolean),
        );
      }
      return { restored: report.restoredPaths.length, canRetry: report.canRetry };
    },
    [onDirectoryChildrenChanged, refreshAfterChange],
  );

  const runUndo = useCallback(async () => {
    if (
      renameInFlightRef.current ||
      deleteInFlightRef.current ||
      copyInFlightRef.current ||
      transferInFlightRef.current
    ) {
      return false;
    }
    // Pop the last action so undo behaves like standard stacks.
    const action = undoStackRef.current.pop();
    if (!action) return false;

    if (action.type === "rename") {
      const requests: RenameRequest[] = action.entries
        .map((entry) => ({
          path: entry.to,
          // Keep the original basename exactly, including legal Unicode whitespace.
          nextName: entry.from.split(/[\\/]/).pop() ?? "",
          expectedIdentity: entry.identity,
        }))
        .filter((item) => item.path && item.nextName);
      // Keep rename undo visually in-place by temporarily disabling
      // add/remove presence animations during the refresh cycle.
      onRenameUndoPresence?.(true);
      try {
        const result = await performRenameRequests(requests, {
          recordUndo: false,
          failureTitle: "Undo completed with issues",
        });
        if (!result) {
          undoStackRef.current.push(action);
          return false;
        }
        if (result.renamed.size === 0) {
          undoStackRef.current.push(action);
          return false;
        }
        const remaining = action.entries.filter(
          (entry) => !result.renamed.has(entry.to),
        );
        if (remaining.length > 0) {
          undoStackRef.current.push({ type: "rename", entries: remaining });
        }
        onDirectoryChildrenChanged?.(
          action.entries
            .flatMap((entry) => [getParentPath(entry.from) ?? "", getParentPath(entry.to) ?? ""])
            .filter(Boolean),
        );
        return true;
      } finally {
        onRenameUndoPresence?.(false);
      }
    }

    if (action.type === "trash") {
      const { restored, remaining } = await restoreTrashedEntries(action.entries);
      if (remaining.length > 0) {
        undoStackRef.current.push({ type: "trash", entries: remaining });
      }
      return restored > 0;
    }

    if (action.type === "move") {
      let restored: number;
      let remaining: UndoMoveEntry[];
      try {
        ({ restored, remaining } = await restoreMovedEntries(action.entries, action.createdFolder));
      } catch (error) {
        undoStackRef.current.push(action);
        usePromptStore.getState().showPrompt({
          title: "Undo failed", content: toMessage(error, "Unable to restore the moved items."),
          confirmLabel: "OK", cancelLabel: null,
        });
        return false;
      }
      let removed = false;
      if (remaining.length > 0) {
        undoStackRef.current.push({ ...action, entries: remaining });
      } else if (action.createdFolder) {
        try {
          removed = await removeCreatedFolderIfEmpty(action.createdFolder);
          if (removed) onDirectoryChildrenChanged?.([getParentPath(action.createdFolder.path) ?? ""]);
        } catch (error) {
          undoStackRef.current.push({ ...action, entries: [] });
          usePromptStore.getState().showPrompt({
            title: "Couldn't remove the empty folder", content: toMessage(error, "The folder was left in place."),
            confirmLabel: "OK", cancelLabel: null,
          });
        }
      }
      if (action.createdFolder && (restored > 0 || removed)) await refreshAfterChange();
      return restored > 0 || removed;
    }

    if (action.type === "recycle") {
      const { restored, canRetry } = await restoreRecycledItems(action.receiptId);
      if (canRetry) {
        undoStackRef.current.push(action);
      }
      return restored > 0;
    }

    return false;
  }, [
    copyInFlightRef,
    deleteInFlightRef,
    onDirectoryChildrenChanged,
    onRenameUndoPresence,
    performRenameRequests,
    refreshAfterChange,
    renameInFlightRef,
    restoreRecycledItems,
    restoreMovedEntries,
    restoreTrashedEntries,
    transferInFlightRef,
    undoStackRef,
  ]);

  const undoLastAction = useCallback(async () => {
    if (undoInFlight.current) return false;
    undoInFlight.current = true;
    try {
      return await runUndo();
    } finally {
      undoInFlight.current = false;
    }
  }, [runUndo]);

  return { undoLastAction };
};
