// Handles undo stack operations for delete/rename actions.
import { useCallback } from "react";
import type { RefObject } from "react";
import { restoreRecycleEntries, statEntries, transferEntries } from "@/api";
import { entryExists, formatFailures, getParentPath, getPathName, toMessage } from "@/lib";
import { usePromptStore } from "@/modules";
import type { RecycleEntry } from "@/types";

export type UndoRenameEntry = {
  from: string;
  to: string;
};

export type UndoTrashEntry = {
  originalPath: string;
  trashPath: string;
};

export type UndoAction =
  | { type: "rename"; entries: UndoRenameEntry[] }
  | { type: "trash"; entries: UndoTrashEntry[] }
  | { type: "recycle"; entries: RecycleEntry[] };

type RenameRequest = {
  path: string;
  nextName: string;
};

type RenameBatchResult = {
  renamed: Map<string, string>;
};

type UseFileManagerUndoOptions = {
  undoStackRef: RefObject<UndoAction[]>;
  renameInFlightRef: RefObject<boolean>;
  deleteInFlightRef: RefObject<boolean>;
  copyInFlightRef: RefObject<boolean>;
  performRenameRequests: (
    renames: RenameRequest[],
    options?: { recordUndo?: boolean; failureTitle?: string },
  ) => Promise<RenameBatchResult | null>;
  refreshAfterChange: () => Promise<void>;
};

export const useFileManagerUndo = ({
  undoStackRef,
  renameInFlightRef,
  deleteInFlightRef,
  copyInFlightRef,
  performRenameRequests,
  refreshAfterChange,
}: UseFileManagerUndoOptions) => {
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

      const grouped = new Map<string, string[]>();
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
        list.push(entry.trashPath);
        grouped.set(parent, list);
      });

      let restored = 0;
      for (const [destination, paths] of grouped) {
        const report = await transferEntries(paths, destination, {
          mode: "move",
          overwrite: false,
        });
        restored += report.moved;
        if (report.failures.length > 0) {
          failures.push(...report.failures);
        }
      }

      const trashMeta = await statEntries(entries.map((entry) => entry.trashPath));
      const remaining: UndoTrashEntry[] = [];
      trashMeta.forEach((meta, index) => {
        if (!entryExists(meta)) return;
        const entry = entries[index];
        if (entry) {
          remaining.push(entry);
        }
      });

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
      }

      return { restored, remaining };
    },
    [refreshAfterChange],
  );

  const restoreRecycledEntries = useCallback(
    async (entries: RecycleEntry[]) => {
      if (entries.length === 0) {
        return { restored: 0, remaining: [] as RecycleEntry[] };
      }
      let report = null;
      try {
        report = await restoreRecycleEntries(entries);
      } catch (error) {
        usePromptStore.getState().showPrompt({
          title: "Undo failed",
          content: toMessage(error, "Failed to restore deleted items."),
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return { restored: 0, remaining: entries };
      }
      if (report.failures.length > 0) {
        usePromptStore.getState().showPrompt({
          title: "Undo completed with issues",
          content: formatFailures(report.failures),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      }
      if (report.restored > 0) {
        await refreshAfterChange();
      }
      return { restored: report.restored, remaining: report.remaining };
    },
    [refreshAfterChange],
  );

  const undoLastAction = useCallback(async () => {
    if (
      renameInFlightRef.current ||
      deleteInFlightRef.current ||
      copyInFlightRef.current
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
          nextName: getPathName(entry.from),
        }))
        .filter((item) => item.path && item.nextName);
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
      return true;
    }

    if (action.type === "trash") {
      const { restored, remaining } = await restoreTrashedEntries(action.entries);
      if (remaining.length > 0) {
        undoStackRef.current.push({ type: "trash", entries: remaining });
      }
      return restored > 0;
    }

    if (action.type === "recycle") {
      const { restored, remaining } = await restoreRecycledEntries(action.entries);
      if (remaining.length > 0) {
        undoStackRef.current.push({ type: "recycle", entries: remaining });
      }
      return restored > 0;
    }

    return false;
  }, [
    copyInFlightRef,
    deleteInFlightRef,
    performRenameRequests,
    renameInFlightRef,
    restoreRecycledEntries,
    restoreTrashedEntries,
    undoStackRef,
  ]);

  return { undoLastAction };
};
