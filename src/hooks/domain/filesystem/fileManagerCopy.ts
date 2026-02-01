// Handles copy/paste/duplicate operations for the file manager.
import { useCallback } from "react";
import type { RefObject } from "react";
import { copyEntries } from "@/api";
import { formatFailures } from "@/lib";
import { usePromptStore, useTransferStore } from "@/modules";

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
  const startTransferJob = useTransferStore((state) => state.startJob);
  const completeTransferJob = useTransferStore((state) => state.completeJob);
  const failTransferJob = useTransferStore((state) => state.failJob);

  // Shared copy pipeline for duplicate/paste actions.
  const runCopyOperation = useCallback(
    async (paths: string[], destination: string, operationLabel: string) => {
      if (copyInFlightRef.current) return null;
      const target = destination.trim();
      if (!target) return null;
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;
      log?.("%s entries: %d items -> %s", operationLabel, unique.length, target);
      copyInFlightRef.current = true;
      const job = startTransferJob({
        label: operationLabel,
        total: unique.length,
        items: unique,
      });
      try {
        const report = await copyEntries(unique, target, job.id);
        if (report.failures.length > 0) {
          usePromptStore.getState().showPrompt({
            title: `${operationLabel} completed with issues`,
            content: formatFailures(report.failures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        if (report.copied > 0 && currentPathRef.current.trim() === target) {
          await refreshAfterChange();
        }
        completeTransferJob(job.id, {
          copied: report.copied,
          skipped: report.skipped,
          failures: report.failures.length,
        });
        return report;
      } catch (error) {
        failTransferJob(job.id);
        const message =
          error instanceof Error && error.message
            ? error.message
            : `Failed to ${operationLabel.toLowerCase()} selected items.`;
        usePromptStore.getState().showPrompt({
          title: `${operationLabel} failed`,
          content: message,
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return null;
      } finally {
        copyInFlightRef.current = false;
      }
    },
    [
      completeTransferJob,
      copyInFlightRef,
      currentPathRef,
      failTransferJob,
      log,
      refreshAfterChange,
      startTransferJob,
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
