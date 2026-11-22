// Mutation orchestration for create/copy/delete/rename/undo actions.
import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { renameEntry } from "@/api";
import { UNDO_STACK_LIMIT } from "@/constants";
import { getParentPath, tabLabel, toMessage } from "@/lib";
import { bumpDirectoryChildVersions, usePromptStore } from "@/modules";
import { useFileManagerCopy } from "./fileManagerCopy";
import { useFileManagerCreate } from "./fileManagerCreate";
import { useFileManagerDelete } from "./fileManagerDelete";
import { useFileManagerUndo } from "./fileManagerUndo";
import type { BeginFileActivity } from "./useFileActivity";
import type { UndoAction, UndoMoveEntry } from "./fileManagerUndo";
import type {
  FileManagerDebug,
  RenameBatchResult,
  RenameFailure,
  RenameRequest,
} from "./fileManager.types";

type UseFileMutationsOptions = {
  beginFileActivity: BeginFileActivity;
  currentPathRef: RefObject<string>;
  refreshAfterChange: () => Promise<void>;
  log: FileManagerDebug;
};

export const useFileMutations = ({
  beginFileActivity,
  currentPathRef,
  refreshAfterChange,
  log,
}: UseFileMutationsOptions) => {
  const deleteInFlightRef = useRef(false);
  const copyInFlightRef = useRef(false);
  const renameInFlightRef = useRef(false);
  const createInFlightRef = useRef(false);
  const transferInFlightRef = useRef(false);
  // In-memory undo stack for the current session.
  const undoStackRef = useRef<UndoAction[]>([]);
  // Lazily resolved trash locations for soft deletes (keyed by drive root).
  const trashRootRef = useRef<Map<string, string>>(new Map());
  const homePathRef = useRef<string | null>(null);
  const homeDriveKeyRef = useRef<string | null>(null);
  // Suppress add/remove presence animation while undoing rename so entries stay in-place.
  const [suppressUndoPresence, setSuppressUndoPresence] = useState(false);
  const pushUndo = useCallback((action: UndoAction) => {
    const stack = undoStackRef.current;
    stack.push(action);
    if (stack.length > UNDO_STACK_LIMIT) {
      stack.shift();
    }
  }, []);

  const canUndo = useCallback(() => undoStackRef.current.length > 0, []);
  const recordMoveUndo = useCallback((entries: UndoMoveEntry[]) => {
    const filtered = entries.filter((entry) => entry.from.trim() && entry.to.trim());
    if (filtered.length === 0) return;
    pushUndo({ type: "move", entries: filtered });
  }, [pushUndo]);
  const setTransferInFlight = useCallback((active: boolean) => {
    transferInFlightRef.current = active;
  }, []);
  const notifyDirectoryChildrenChanged = useCallback((paths: string[]) => {
    bumpDirectoryChildVersions(paths);
  }, []);

  const { createFolderInView, createFileInView } = useFileManagerCreate({
    beginFileActivity,
    currentPathRef,
    createInFlightRef,
    refreshAfterChange,
    onDirectoryChildrenChanged: notifyDirectoryChildrenChanged,
  });

  const { duplicateEntriesInView, pasteEntriesInView } = useFileManagerCopy({
    beginFileActivity,
    currentPathRef,
    copyInFlightRef,
    refreshAfterChange,
    onRecordMoveUndo: recordMoveUndo,
    onDirectoryChildrenChanged: notifyDirectoryChildrenChanged,
    log,
  });

  const { deleteEntriesInView } = useFileManagerDelete({
    deleteInFlightRef,
    trashRootRef,
    homePathRef,
    homeDriveKeyRef,
    pushUndo,
    refreshAfterChange,
    onDirectoryChildrenChanged: notifyDirectoryChildrenChanged,
    log,
  });

  const performRenameRequests = useCallback(
    async (
      renames: RenameRequest[],
      options?: { recordUndo?: boolean; failureTitle?: string },
    ): Promise<RenameBatchResult | null> => {
      if (renameInFlightRef.current) return null;
      const nextRenames: RenameRequest[] = [];
      const seen = new Set<string>();
      renames.forEach((item) => {
        const path = item.path;
        const nextName = item.nextName;
        if (!path.trim() || !nextName.trim()) return;
        if (seen.has(path)) return;
        seen.add(path);
        nextRenames.push({ path, nextName });
      });
      if (nextRenames.length === 0) return null;
      renameInFlightRef.current = true;
      const finish = beginFileActivity(nextRenames.length === 1
        ? `Renaming ${tabLabel(nextRenames[0].path)}`
        : `Renaming ${nextRenames.length} items`);
      const failures: RenameFailure[] = [];
      const renamed = new Map<string, string>();
      try {
        for (const item of nextRenames) {
          try {
            const nextPath = await renameEntry(item.path, item.nextName);
            if (nextPath) {
              renamed.set(item.path, nextPath);
            }
          } catch (error) {
            failures.push({
              path: item.path,
              nextName: item.nextName,
              message: toMessage(error, "Failed to rename item."),
            });
          }
        }
        if (failures.length > 0) {
          const title = options?.failureTitle ?? "Rename completed with issues";
          const samples = failures.slice(0, 4).map((failure) => {
            const label = tabLabel(failure.path);
            return `${label} -> ${failure.nextName}\n${failure.message}`;
          });
          const suffix =
            failures.length > samples.length
              ? `\n...and ${failures.length - samples.length} more`
              : "";
          usePromptStore.getState().showPrompt({
            title,
            content: `${samples.join("\n\n")}${suffix}`,
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        if (renamed.size > 0) {
          await refreshAfterChange();
          notifyDirectoryChildrenChanged(
            Array.from(renamed).flatMap(([from, to]) => [
              getParentPath(from) ?? "",
              getParentPath(to) ?? "",
            ]),
          );
          if (options?.recordUndo !== false) {
            const undoEntries = Array.from(renamed).map(([from, to]) => ({
              from,
              to,
            }));
            pushUndo({ type: "rename", entries: undoEntries });
          }
        }
        return { renamed, failures };
      } finally {
        finish();
        renameInFlightRef.current = false;
      }
    },
    [beginFileActivity, notifyDirectoryChildrenChanged, pushUndo, refreshAfterChange],
  );

  const renameEntryInView = useCallback(
    async (path: string, newName: string) => {
      const result = await performRenameRequests([{ path, nextName: newName }]);
      if (!result) return null;
      return result.renamed.get(path) ?? null;
    },
    [performRenameRequests],
  );

  // Batch rename with a single refresh + consolidated error reporting.
  const renameEntriesInView = useCallback(
    async (renames: RenameRequest[]): Promise<RenameBatchResult | null> =>
      performRenameRequests(renames),
    [performRenameRequests],
  );

  const { undoLastAction } = useFileManagerUndo({
    undoStackRef,
    renameInFlightRef,
    deleteInFlightRef,
    copyInFlightRef,
    transferInFlightRef,
    onDirectoryChildrenChanged: notifyDirectoryChildrenChanged,
    onRenameUndoPresence: setSuppressUndoPresence,
    performRenameRequests,
    refreshAfterChange,
  });

  return {
    suppressUndoPresence,
    deleteEntriesInView,
    duplicateEntriesInView,
    pasteEntriesInView,
    createFolderInView,
    createFileInView,
    renameEntryInView,
    renameEntriesInView,
    recordMoveUndo,
    setTransferInFlight,
    undoLastAction,
    canUndo,
  };
};
