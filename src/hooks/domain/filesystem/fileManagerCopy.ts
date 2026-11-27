// Handles copy, move, duplicate, and clipboard paste for the file manager.
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { copyEntries, createTrackedFolder, finishFileCut, planCopyEntries, removeCreatedFolderIfEmpty } from "@/api";
import { folderPathKey, formatFailures, getParentPath, normalizeDropPath, toMessage } from "@/lib";
import { refreshFileClipboard, usePromptStore, useTransferStore } from "@/modules";
import { captureMoveHistoryWorkspace } from "@/modules/recentMoveStore";
import type { UndoMoveEntry } from "./fileManagerUndo";
import type { CreatedFolder } from "@/types/fs";
import type { BeginFileActivity } from "./useFileActivity";
import { planDropTransfer, resolveDropTransferConflicts } from "./dropTransferPlanning";
import { runDropTransfer } from "./runDropTransfer";
import { resolveCopyConflicts } from "@/hooks/domain/filesystem/copyConflictResolution";
import { readRemoteClipboard } from "@/modules/clipboardStore";
import { pasteRemoteClipboardToLocal } from "@/modules/remoteClipboard";
import {
  getTransferErrorMessage,
  isTransferCancelledError,
} from "@/hooks/domain/filesystem/transferJobErrors";

type UseFileManagerCopyOptions = {
  beginFileActivity: BeginFileActivity;
  currentPathRef: RefObject<string>;
  copyInFlightRef: RefObject<boolean>;
  refreshAfterChange: () => Promise<void>;
  onRecordMoveUndo: (entries: UndoMoveEntry[], createdFolder?: CreatedFolder) => void;
  onDirectoryChildrenChanged?: (paths: string[]) => void;
  log?: (...args: unknown[]) => void;
};

export const useFileManagerCopy = ({
  beginFileActivity,
  currentPathRef,
  copyInFlightRef,
  refreshAfterChange,
  onRecordMoveUndo,
  onDirectoryChildrenChanged,
  log,
}: UseFileManagerCopyOptions) => {
  // Keep Undo guarded while copy or move requests are preparing or running.
  const activeCopyRequestCountRef = useRef(0);
  const activeCuts = useRef(new Set<number>());
  const registerTransferJob = useTransferStore((state) => state.registerFileJob);
  const recordTransferJobOutcome = useTransferStore((state) => state.recordJobOutcome);
  const trackRequest = useCallback(() => {
    activeCopyRequestCountRef.current++;
    copyInFlightRef.current = true;
    return () => {
      activeCopyRequestCountRef.current--;
      copyInFlightRef.current = activeCopyRequestCountRef.current > 0;
    };
  }, [copyInFlightRef]);

  // Shared copy pipeline for duplicate, paste and pane transfers.
  const runCopyOperation = useCallback(
    async (paths: string[], destination: string, operationLabel: string) => {
      const target = destination.trim();
      if (!target) return null;
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;
      log?.("%s entries: %d items -> %s", operationLabel, unique.length, target);
      const finishRequest = trackRequest();
      const promptStore = usePromptStore.getState();
      let job: ReturnType<typeof registerTransferJob> | null = null;
      const finishPreparing = beginFileActivity(`Preparing ${operationLabel.toLowerCase()} in ${target}`);
      try {
        const plan = await planCopyEntries(unique, target);
        const conflictResolution = await resolveCopyConflicts(
          plan.conflicts,
          promptStore,
        );
        if (conflictResolution.cancelled) {
          return null;
        }
        finishPreparing();
        job = registerTransferJob({
          label: operationLabel,
          items: unique,
          kind: "transfer",
        });
        const report = await copyEntries(
          unique,
          target,
          {
            overwritePaths: conflictResolution.overwritePaths,
            skipPaths: conflictResolution.skipPaths,
          },
          job.id,
        );
        if (report.failures.length > 0) {
          promptStore.showPrompt({
            title: `${operationLabel} completed with issues`,
            content: formatFailures(report.failures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        if (report.copied > 0 && currentPathRef.current.trim() === target) {
          await refreshAfterChange();
        }
        if (report.copied > 0) {
          onDirectoryChildrenChanged?.([target]);
        }
        recordTransferJobOutcome(job.id, {
          copied: report.copied,
          skipped: report.skipped,
          failures: report.failures.length,
        });
        return report;
      } catch (error) {
        if (isTransferCancelledError(error)) {
          if (currentPathRef.current.trim() === target) {
            await refreshAfterChange();
          }
          return null;
        }
        if (job) {
          recordTransferJobOutcome(job.id, { failures: 1 });
        }
        const message = getTransferErrorMessage(
          error,
          `Failed to ${operationLabel.toLowerCase()} selected items.`,
        );
        promptStore.showPrompt({
          title: `${operationLabel} failed`,
          content: message,
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return null;
      } finally {
        job?.finish();
        finishPreparing();
        finishRequest();
      }
    },
    [
      beginFileActivity,
      currentPathRef,
      log,
      onDirectoryChildrenChanged,
      recordTransferJobOutcome,
      registerTransferJob,
      refreshAfterChange,
      trackRequest,
    ],
  );

  const duplicateEntriesInView = useCallback(
    async (paths: string[], destination = currentPathRef.current) =>
      runCopyOperation(paths, destination, "Duplicate"),
    [currentPathRef, runCopyOperation],
  );

  const copyEntriesToFolder = useCallback(
    (paths: string[], destination: string) => runCopyOperation(paths, destination, "Copy"),
    [runCopyOperation],
  );

  // Clipboard moves and direct context-menu moves share conflict prompts, the
  // backend queue, last-used destinations, and the grouped Undo action.
  const runMoveOperation = useCallback(async (
    paths: string[],
    destination: string,
    moveHistoryWorkspace: string | null | undefined,
    finishPreparing: () => void,
    createdFolder?: CreatedFolder,
  ) => {
    const plan = planDropTransfer(paths, destination, "move");
    if (!plan) return;
    const prompts = usePromptStore.getState();
    // A new selection folder has no approved replacements, even if another
    // process writes into it before the queued move runs.
    const resolved = createdFolder
      ? { ...plan, overwritePaths: [], skippedByPrompt: 0 }
      : await resolveDropTransferConflicts(plan, prompts);
    if (!resolved) return;
    finishPreparing();
    return runDropTransfer({
      plan: resolved,
      protectedFolder: createdFolder,
      moveHistoryWorkspace,
      promptStore: prompts,
      currentPathKey: normalizeDropPath(currentPathRef.current),
      onRefresh: refreshAfterChange,
      onRecordMoveUndo: (entries) => onRecordMoveUndo(entries, createdFolder),
      transferStore: {
        registerTransferJob,
        recordTransferJobOutcome,
        updateTransferLabel: useTransferStore.getState().updateJobLabel,
      },
    });
  }, [currentPathRef, onRecordMoveUndo, recordTransferJobOutcome, refreshAfterChange, registerTransferJob]);

  const moveEntriesInView = useCallback(async (paths: string[], destination: string) => {
    const moveHistoryWorkspace = captureMoveHistoryWorkspace();
    const finishRequest = trackRequest();
    const finishPreparing = beginFileActivity(`Preparing to move into ${destination}`);
    try {
      return await runMoveOperation(paths, destination, moveHistoryWorkspace, finishPreparing);
    } catch (error) {
      usePromptStore.getState().showPrompt({
        title: "Move failed",
        content: getTransferErrorMessage(error, "Failed to move selected items."),
        confirmLabel: "OK",
        cancelLabel: null,
      });
    } finally {
      finishPreparing();
      finishRequest();
    }
  }, [beginFileActivity, runMoveOperation, trackRequest]);

  const createFolderWithSelection = useCallback(async (
    paths: string[], parent: string, name: string, onCreated: () => void,
  ) => {
    const parentKey = folderPathKey(parent);
    if (!parentKey || !paths.length || paths.some((path) =>
      path !== path.trim() || folderPathKey(getParentPath(path) ?? "") !== parentKey)) {
      throw new Error("Choose items in the same folder with paths that Stratum can move.");
    }
    const finishRequest = trackRequest();
    const finishPreparing = beginFileActivity(`Creating ${name}`);
    const workspace = captureMoveHistoryWorkspace();
    try {
      const folder = await createTrackedFolder(parent, name);
      onCreated();
      const report = await runMoveOperation(paths, folder.path, workspace, finishPreparing, folder);
      if (report?.moved || report?.copied) return folder.path;
      try {
        await removeCreatedFolderIfEmpty(folder);
      } catch (error) {
        const prompts = usePromptStore.getState();
        if (!prompts.prompt) {
          prompts.showPrompt({
            title: "Couldn't remove the empty folder",
            content: toMessage(error, "The folder was left in place."),
            confirmLabel: "OK", cancelLabel: null,
          });
        }
      }
      onDirectoryChildrenChanged?.([parent]);
      if (folderPathKey(currentPathRef.current) === parentKey) void refreshAfterChange();
      return null;
    } finally {
      finishPreparing();
      finishRequest();
    }
  }, [beginFileActivity, currentPathRef, onDirectoryChildrenChanged, refreshAfterChange, runMoveOperation, trackRequest]);

  const pasteEntriesInView = useCallback(
    async (destination?: string) => {
      const target = (destination ?? currentPathRef.current).trim();
      if (!target) return;
      const prompts = usePromptStore.getState();
      const moveHistoryWorkspace = captureMoveHistoryWorkspace();
      let cutSequence: number | undefined;
      let finishRequest: (() => void) | undefined;
      let moved = false;
      const finishPreparing = beginFileActivity(`Preparing to paste into ${target}`);
      try {
        const remote = await readRemoteClipboard();
        if (remote) { await pasteRemoteClipboardToLocal(target, remote); return; }
        const clipboard = await refreshFileClipboard();
        if (!clipboard.paths.length) return;
        if (clipboard.mode === "copy") return copyEntriesToFolder(clipboard.paths, target);
        if (activeCuts.current.has(clipboard.sequence)) return;
        cutSequence = clipboard.sequence;
        activeCuts.current.add(cutSequence);
        finishRequest = trackRequest();
        const report = await runMoveOperation(clipboard.paths, target, moveHistoryWorkspace, finishPreparing);
        if (report?.movedEntries.length) {
          moved = true;
          await finishFileCut(cutSequence, report.movedEntries.map((entry) => entry.sourcePath));
          await refreshFileClipboard();
        }
        return report;
      } catch (error) {
        prompts.showPrompt({
          title: moved ? "Couldn't update the cut selection" : "Paste failed",
          content: getTransferErrorMessage(error, "Windows could not access the file clipboard."),
          confirmLabel: "OK",
          cancelLabel: null,
        });
      } finally {
        finishPreparing();
        if (cutSequence !== undefined) activeCuts.current.delete(cutSequence);
        finishRequest?.();
      }
    },
    [beginFileActivity, copyEntriesToFolder, currentPathRef, runMoveOperation, trackRequest],
  );

  return {
    copyEntriesToFolder,
    duplicateEntriesInView,
    moveEntriesInView,
    createFolderWithSelection,
    pasteEntriesInView,
  };
};
