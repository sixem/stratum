// Handles the native Windows recycle-bin delete path and its permanent-delete fallback.
import {
  isManagedJobCancelledError,
} from "@/hooks/domain/filesystem/transferJobErrors";
import {
  buildDeleteReport,
  promptPermanentDeleteFallback,
  showDeleteError,
  showDeleteIssues,
} from "./fileManagerDeleteShared";
import type {
  DeleteFlowContext,
  ManagedDeleteOperations,
} from "./fileManagerDelete.types";

type RunNativeRecycleDeleteOptions = {
  paths: string[];
  operations: ManagedDeleteOperations;
  context: DeleteFlowContext;
};

export const runNativeRecycleDelete = async ({
  paths,
  operations,
  context,
}: RunNativeRecycleDeleteOptions) => {
  // Capture delete time so undo can resolve recycle metadata even if the shell
  // writes recycle info slightly after delete returns.
  const deleteStartedAtMs = Math.max(0, Date.now() - 5_000);
  let report = null;

  try {
    report = await operations.runManagedTrashEntries(paths);
  } catch (error) {
    if (isManagedJobCancelledError(error)) {
      return null;
    }
    showDeleteError(
      context.promptStore,
      error,
      "Failed to delete selected items.",
    );
    return null;
  }

  const recycledPaths = report.recycled.map((entry) => entry.originalPath);
  if (recycledPaths.length > 0) {
    context.pushUndo({
      type: "recyclePaths",
      paths: recycledPaths,
      deletedAfterMs: deleteStartedAtMs,
    });
  } else if (report.deleted > 0) {
    const recycledRoots = paths.filter((path) => !report.failedPaths.includes(path));
    if (recycledRoots.length > 0) {
      context.pushUndo({
        type: "recyclePaths",
        paths: recycledRoots,
        deletedAfterMs: deleteStartedAtMs,
      });
    }
  }
  if (report.deleted > 0) {
    await context.refreshAfterChange();
  }
  if (report.cancelled) {
    return buildDeleteReport(
      report.deleted,
      report.skipped,
      true,
      report.failures,
    );
  }

  const remainingPaths = report.failedPaths;
  if (remainingPaths.length > 0) {
    const reasons: string[] = [];
    if (report.failures.length > 0) {
      reasons.push(
        `Recycle Bin unavailable for some items:\n${report.failures.join("\n")}`,
      );
    }
    if (reasons.length === 0) {
      reasons.push("Some items could not be moved to the Recycle Bin.");
    }

    return promptPermanentDeleteFallback({
      promptStore: context.promptStore,
      title: "Couldn't move items to Recycle Bin",
      reasons,
      remainingPaths,
      onConfirm: async () => {
        try {
          const hardReport = await operations.runManagedDeleteEntries(remainingPaths);
          if (hardReport.deleted > 0) {
            await context.refreshAfterChange();
          }
          showDeleteIssues(context.promptStore, hardReport.cancelled ? [] : hardReport.failures);
          return buildDeleteReport(
            report.deleted + hardReport.deleted,
            report.skipped + hardReport.skipped,
            hardReport.cancelled,
            [...report.failures, ...hardReport.failures],
          );
        } catch (error) {
          if (isManagedJobCancelledError(error)) {
            return buildDeleteReport(
              report.deleted,
              report.skipped,
              true,
              report.failures,
            );
          }
          showDeleteError(
            context.promptStore,
            error,
            "Failed to delete selected items.",
          );
          return buildDeleteReport(
            report.deleted,
            report.skipped,
            false,
            report.failures,
          );
        }
      },
      onCancel: () =>
        buildDeleteReport(report.deleted, report.skipped, false, report.failures),
    });
  }

  showDeleteIssues(context.promptStore, report.failures);
  return buildDeleteReport(report.deleted, report.skipped, false, report.failures);
};
