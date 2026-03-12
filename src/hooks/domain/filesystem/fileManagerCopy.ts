// Handles copy/paste/duplicate operations for the file manager.
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { copyEntries, planCopyEntries } from "@/api";
import { formatFailures } from "@/lib";
import { usePromptStore, useTransferStore } from "@/modules";
import { resolveCopyConflicts } from "@/hooks/domain/filesystem/copyConflictResolution";
import {
  getTransferErrorMessage,
  isTransferCancelledError,
} from "@/hooks/domain/filesystem/transferJobErrors";

type UseFileManagerCopyOptions = {
  currentPathRef: RefObject<string>;
  copyInFlightRef: RefObject<boolean>;
  refreshAfterChange: () => Promise<void>;
  log?: (...args: unknown[]) => void;
};

export const useFileManagerCopy = ({
  currentPathRef,
  copyInFlightRef,
  refreshAfterChange,
  log,
}: UseFileManagerCopyOptions) => {
  // Track overlapping copy requests so the rest of the file manager can still
  // answer "is any copy-related work pending?" without blocking queueing.
  const activeCopyRequestCountRef = useRef(0);
  const registerTransferJob = useTransferStore((state) => state.registerJob);
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
      try {
        const plan = await planCopyEntries(unique, target);
        const conflictResolution = await resolveCopyConflicts(
          plan.conflicts,
          promptStore,
        );
        if (conflictResolution.cancelled) {
          return null;
        }
        job = registerTransferJob({
          label: operationLabel,
          items: unique,
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
        activeCopyRequestCountRef.current = Math.max(
          activeCopyRequestCountRef.current - 1,
          0,
        );
        copyInFlightRef.current = activeCopyRequestCountRef.current > 0;
      }
    },
    [
      activeCopyRequestCountRef,
      copyInFlightRef,
      currentPathRef,
      log,
      recordTransferJobOutcome,
      registerTransferJob,
      refreshAfterChange,
    ],
  );

  const duplicateEntriesInView = useCallback(
    async (paths: string[]) =>
      runCopyOperation(paths, currentPathRef.current, "Duplicate"),
    [currentPathRef, runCopyOperation],
  );

  const pasteEntriesInView = useCallback(
    async (paths: string[], destination?: string) => {
      const target = destination ?? currentPathRef.current;
      // Use a clear transfer label for clipboard copies.
      return runCopyOperation(paths, target, "Copy");
    },
    [currentPathRef, runCopyOperation],
  );

  return {
    duplicateEntriesInView,
    pasteEntriesInView,
  };
};
