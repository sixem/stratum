// Handles copy/paste/duplicate operations for the file manager.
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { copyEntries, finishFileCut, planCopyEntries } from "@/api";
import { formatFailures, normalizeDropPath } from "@/lib";
import { refreshFileClipboard, usePromptStore, useTransferStore } from "@/modules";
import type { UndoMoveEntry } from "./fileManagerUndo";
import type { BeginFileActivity } from "./useFileActivity";
import { planDropTransfer, resolveDropTransferConflicts } from "./dropTransferPlanning";
import { runDropTransfer } from "./runDropTransfer";
import { resolveCopyConflicts } from "@/hooks/domain/filesystem/copyConflictResolution";
import {
  getTransferErrorMessage,
  isTransferCancelledError,
} from "@/hooks/domain/filesystem/transferJobErrors";

type UseFileManagerCopyOptions = {
  beginFileActivity: BeginFileActivity;
  currentPathRef: RefObject<string>;
  copyInFlightRef: RefObject<boolean>;
  refreshAfterChange: () => Promise<void>;
  onRecordMoveUndo: (entries: UndoMoveEntry[]) => void;
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
  // Track overlapping copy requests so the rest of the file manager can still
  // answer "is any copy-related work pending?" without blocking queueing.
  const activeCopyRequestCountRef = useRef(0);
  const activeCuts = useRef(new Set<number>());
  const registerTransferJob = useTransferStore((state) => state.registerFileJob);
  const recordTransferJobOutcome = useTransferStore((state) => state.recordJobOutcome);

  // Shared copy pipeline for duplicate/paste actions.
  const runCopyOperation = useCallback(
    async (paths: string[], destination: string, operationLabel: string) => {
      const target = destination.trim();
      if (!target) return null;
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;
      log?.("%s entries: %d items -> %s", operationLabel, unique.length, target);
      activeCopyRequestCountRef.current += 1;
      copyInFlightRef.current = true;
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
        activeCopyRequestCountRef.current = Math.max(
          activeCopyRequestCountRef.current - 1,
          0,
        );
        copyInFlightRef.current = activeCopyRequestCountRef.current > 0;
      }
    },
    [
      activeCopyRequestCountRef,
      beginFileActivity,
      copyInFlightRef,
      currentPathRef,
      log,
      onDirectoryChildrenChanged,
      recordTransferJobOutcome,
      registerTransferJob,
      refreshAfterChange,
    ],
  );

  const duplicateEntriesInView = useCallback(
    async (paths: string[], destination = currentPathRef.current) =>
      runCopyOperation(paths, destination, "Duplicate"),
    [currentPathRef, runCopyOperation],
  );

  const pasteEntriesInView = useCallback(
    async (destination?: string) => {
      const target = (destination ?? currentPathRef.current).trim();
      if (!target) return;
      const prompts = usePromptStore.getState();
      let cutSequence: number | undefined;
      let moved = false;
      const finishPreparing = beginFileActivity(`Preparing to paste into ${target}`);
      try {
        const clipboard = await refreshFileClipboard();
        if (!clipboard.paths.length) return;
        if (clipboard.mode === "copy") return runCopyOperation(clipboard.paths, target, "Copy");
        if (activeCuts.current.has(clipboard.sequence)) return;
        cutSequence = clipboard.sequence;
        activeCuts.current.add(cutSequence);
        activeCopyRequestCountRef.current++;
        copyInFlightRef.current = true;
        const plan = planDropTransfer(clipboard.paths, target, "move");
        if (!plan) return;
        const resolved = await resolveDropTransferConflicts(plan, prompts);
        if (!resolved) return;
        finishPreparing();
        const report = await runDropTransfer({
          plan: resolved,
          promptStore: prompts,
          currentPathKey: normalizeDropPath(currentPathRef.current),
          onRefresh: refreshAfterChange,
          onRecordMoveUndo,
          transferStore: {
            registerTransferJob,
            recordTransferJobOutcome,
            updateTransferLabel: useTransferStore.getState().updateJobLabel,
          },
        });
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
        if (cutSequence !== undefined) {
          activeCuts.current.delete(cutSequence);
          activeCopyRequestCountRef.current--;
          copyInFlightRef.current = activeCopyRequestCountRef.current > 0;
        }
      }
    },
    [
      beginFileActivity, copyInFlightRef, currentPathRef, onRecordMoveUndo,
      recordTransferJobOutcome, refreshAfterChange, registerTransferJob, runCopyOperation,
    ],
  );

  return {
    duplicateEntriesInView,
    pasteEntriesInView,
  };
};
