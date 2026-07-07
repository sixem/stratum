// Handles undo stack operations for delete, rename, and move actions.
import { useCallback } from "react";
import type { RefObject } from "react";
import { restoreRecyclePaths, statEntries, transferEntries } from "@/api";
import { entryExists, formatFailures, getParentPath, getPathName, toMessage } from "@/lib";
import { usePromptStore } from "@/modules";

export type UndoRenameEntry = {
  from: string;
  to: string;
};

export type UndoTrashEntry = {
  originalPath: string;
  trashPath: string;
};

export type UndoMoveEntry = {
  from: string;
  to: string;
};

export type UndoAction =
  | { type: "rename"; entries: UndoRenameEntry[] }
  | { type: "move"; entries: UndoMoveEntry[] }
  | { type: "trash"; entries: UndoTrashEntry[] }
  | { type: "recyclePaths"; paths: string[]; deletedAfterMs: number };

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
  transferInFlightRef: RefObject<boolean>;
  onRenameUndoPresence?: (suppress: boolean) => void;
  onDirectoryChildrenChanged?: (paths: string[]) => void;
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
  transferInFlightRef,
  onRenameUndoPresence,
  onDirectoryChildrenChanged,
  performRenameRequests,
  refreshAfterChange,
}: UseFileManagerUndoOptions) => {
  const restoreMovedEntries = useCallback(
    async (entries: UndoMoveEntry[]) => {
      if (entries.length === 0) {
        return { restored: 0, remaining: [] as UndoMoveEntry[] };
      }

      const currentPaths = entries.map((entry) => entry.to);
      const currentMeta = await statEntries(currentPaths);
      const existingDestinations = await statEntries(entries.map((entry) => entry.from));
      const grouped = new Map<string, string[]>();
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
        list.push(entry.to);
        grouped.set(destination, list);
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

      const remainingMeta = await statEntries(entries.map((entry) => entry.to));
      const remaining: UndoMoveEntry[] = [];
      remainingMeta.forEach((meta, index) => {
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
        onDirectoryChildrenChanged?.(
          entries.map((entry) => getParentPath(entry.originalPath) ?? "").filter(Boolean),
        );
      }

      return { restored, remaining };
    },
    [refreshAfterChange],
  );

  const restoreRecycledPaths = useCallback(
    async (paths: string[], deletedAfterMs?: number) => {
      if (paths.length === 0) {
        return { restored: 0, remaining: [] as string[] };
      }
      let report = null;
      try {
        report = await restoreRecyclePaths(paths, deletedAfterMs);
      } catch (error) {
        usePromptStore.getState().showPrompt({
          title: "Undo failed",
          content: toMessage(error, "Failed to restore deleted items."),
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return { restored: 0, remaining: paths };
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
        onDirectoryChildrenChanged?.(
          paths.map((path) => getParentPath(path) ?? "").filter(Boolean),
        );
      }
      return { restored: report.restored, remaining: report.remainingPaths };
    },
    [refreshAfterChange],
  );

  const undoLastAction = useCallback(async () => {
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
          nextName: getPathName(entry.from),
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
      const { restored, remaining } = await restoreMovedEntries(action.entries);
      if (remaining.length > 0) {
        undoStackRef.current.push({ type: "move", entries: remaining });
      }
      return restored > 0;
    }

    if (action.type === "recyclePaths") {
      const { restored, remaining } = await restoreRecycledPaths(
        action.paths,
        action.deletedAfterMs,
      );
      if (remaining.length > 0) {
        undoStackRef.current.push({
          type: "recyclePaths",
          paths: remaining,
          deletedAfterMs: action.deletedAfterMs,
        });
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
    renameInFlightRef,
    restoreRecycledPaths,
    restoreMovedEntries,
    restoreTrashedEntries,
    transferInFlightRef,
    undoStackRef,
  ]);

  return { undoLastAction };
};
