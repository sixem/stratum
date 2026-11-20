// Handles the cross-platform trash-folder delete path and its permanent-delete fallback.
import { ensureDir, statEntries } from "@/api";
import {
  isManagedJobCancelledError,
} from "@/hooks/domain/filesystem/transferJobErrors";
import { entryExists, formatFailures, tabLabel, toMessage } from "@/lib";
import type { UndoTrashEntry } from "../fileManagerUndo";
import {
  buildDeleteReport,
  promptPermanentDeleteFallback,
  showDeleteError,
  showDeleteIssues,
} from "./fileManagerDeleteShared";
import type {
  DeleteFlowContext,
  ManagedDeleteOperations,
  TrashLocationHelpers,
} from "./fileManagerDelete.types";

type RunManagedTrashMoveDeleteOptions = {
  paths: string[];
  operations: ManagedDeleteOperations;
  context: DeleteFlowContext;
  locations: TrashLocationHelpers;
};

export const runManagedTrashMoveDelete = async ({
  paths,
  operations,
  context,
  locations,
}: RunManagedTrashMoveDeleteOptions) => {
  const trashGroups = new Map<string, string[]>();
  const trashFailures: string[] = [];
  const moved: UndoTrashEntry[] = [];
  const remaining = new Set<string>();
  const transferFailures: string[] = [];
  let cancelled = false;

  for (const path of paths) {
    try {
      const trashRoot = await locations.resolveTrashRootForPath(path);
      const group = trashGroups.get(trashRoot) ?? [];
      group.push(path);
      trashGroups.set(trashRoot, group);
    } catch (error) {
      trashFailures.push(
        `${tabLabel(path)}: ${toMessage(error, "Trash is unavailable.")}`,
      );
      remaining.add(path);
    }
  }

  for (const [trashRoot, trashCandidates] of trashGroups) {
    if (trashCandidates.length === 0) continue;

    // Move items into a per-delete batch folder so undo can restore them.
    const batchDir = locations.buildTrashBatchDir(trashRoot);
    await ensureDir(batchDir);

    const pending = new Set(trashCandidates);
    try {
      const report = await operations.runManagedTrashMove(trashCandidates, batchDir);
      transferFailures.push(...report.failures);
      for (const entry of report.movedEntries) {
        moved.push({ originalPath: entry.sourcePath, trashPath: entry.destinationPath });
        pending.delete(entry.sourcePath);
      }
      cancelled = report.cancelled;
    } catch (error) {
      if (!isManagedJobCancelledError(error)) {
        showDeleteError(
          context.promptStore,
          error,
          "Failed to delete selected items.",
        );
        return null;
      }
      cancelled = true;
    }

    if (cancelled) break;
    if (pending.size === 0) continue;

    // A new file may already occupy a successfully trashed source path.
    const pendingPaths = Array.from(pending);
    const originalMeta = await statEntries(pendingPaths);
    originalMeta.forEach((meta, index) => {
      const path = pendingPaths[index] ?? "";
      if (path && entryExists(meta)) {
        remaining.add(path);
      }
    });
  }

  if (moved.length > 0) {
    context.pushUndo({ type: "trash", entries: moved });
    await context.refreshAfterChange();
  }

  const remainingPaths = Array.from(remaining);
  const combinedFailures = [...trashFailures, ...transferFailures];
  if (cancelled) {
    return buildDeleteReport(
      moved.length,
      Math.max(0, paths.length - moved.length),
      true,
      combinedFailures,
    );
  }

  if (remainingPaths.length > 0) {
    const reasons: string[] = [];
    if (trashFailures.length > 0) {
      reasons.push(
        `Trash unavailable for some items:\n${formatFailures(trashFailures)}`,
      );
    }
    if (transferFailures.length > 0) {
      reasons.push(
        `Move to Trash failed for some items:\n${formatFailures(transferFailures)}`,
      );
    }
    if (reasons.length === 0) {
      reasons.push("Some items could not be moved to the Trash.");
    }

    return promptPermanentDeleteFallback({
      promptStore: context.promptStore,
      title: "Couldn't move items to Trash",
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
            moved.length + hardReport.deleted,
            Math.max(0, paths.length - moved.length - hardReport.deleted),
            hardReport.cancelled,
            [...combinedFailures, ...hardReport.failures],
          );
        } catch (error) {
          if (isManagedJobCancelledError(error)) {
            return buildDeleteReport(
              moved.length,
              Math.max(0, paths.length - moved.length),
              true,
              combinedFailures,
            );
          }
          showDeleteError(
            context.promptStore,
            error,
            "Failed to delete selected items.",
          );
          return buildDeleteReport(
            moved.length,
            Math.max(0, paths.length - moved.length),
            false,
            combinedFailures,
          );
        }
      },
      onCancel: () =>
        buildDeleteReport(
          moved.length,
          Math.max(0, paths.length - moved.length),
          false,
          combinedFailures,
        ),
    });
  }

  showDeleteIssues(context.promptStore, combinedFailures);
  return buildDeleteReport(
    moved.length,
    Math.max(0, paths.length - moved.length),
    false,
    combinedFailures,
  );
};
