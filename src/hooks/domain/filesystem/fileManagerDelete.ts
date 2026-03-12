// Handles delete and trash operations for the file manager.
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import {
  deleteEntries as deleteEntriesApi,
  ensureDir,
  getHome,
  statEntries,
  trashEntries,
  transferEntries,
} from "@/api";
import {
  getManagedJobErrorMessage,
  isManagedJobCancelledError,
} from "@/hooks/domain/filesystem/transferJobErrors";
import {
  entryExists,
  formatFailures,
  getDriveKey,
  getPathName,
  joinPath,
  normalizePath,
  tabLabel,
  toMessage,
} from "@/lib";
import { usePromptStore, useTransferStore } from "@/modules";
import type { DeleteReport } from "@/types";
import type { UndoAction, UndoTrashEntry } from "./fileManagerUndo";

type UseFileManagerDeleteOptions = {
  deleteInFlightRef: RefObject<boolean>;
  trashRootRef: RefObject<Map<string, string>>;
  homePathRef: RefObject<string | null>;
  homeDriveKeyRef: RefObject<string | null>;
  pushUndo: (action: UndoAction) => void;
  refreshAfterChange: () => Promise<void>;
  log?: (...args: unknown[]) => void;
};

const TRASH_DIR_NAME = ".stratum-trash";

const isWindowsEnv = () => {
  if (typeof navigator === "undefined") return false;
  return /windows/i.test(navigator.userAgent);
};

const isTauriEnv = () =>
  "__TAURI_INTERNALS__" in globalThis || "__TAURI__" in globalThis;

export const useFileManagerDelete = ({
  deleteInFlightRef,
  trashRootRef,
  homePathRef,
  homeDriveKeyRef,
  pushUndo,
  refreshAfterChange,
  log,
}: UseFileManagerDeleteOptions) => {
  // Track overlapping delete requests without blocking the backend queue from
  // showing later jobs immediately in the shared operations log.
  const activeDeleteRequestCountRef = useRef(0);
  const registerTransferJob = useTransferStore((state) => state.registerJob);
  const recordTransferJobOutcome = useTransferStore((state) => state.recordJobOutcome);

  const driveKeyToRoot = useCallback((driveKey: string) => {
    if (!driveKey) return null;
    if (driveKey.startsWith("\\\\")) {
      return `${driveKey}\\`;
    }
    if (/^[a-z]:$/i.test(driveKey)) {
      return `${driveKey.toUpperCase()}\\`;
    }
    if (driveKey === "/") return "/";
    return null;
  }, []);

  // Use a hidden-ish folder per drive so deletes stay on-volume.
  const resolveTrashRootForPath = useCallback(
    async (path: string) => {
      const driveKey = getDriveKey(path);
      if (!driveKey) {
        throw new Error("Trash is unavailable.");
      }
      const cached = trashRootRef.current.get(driveKey);
      if (cached) return cached;
      // Favor the home folder on the home drive to avoid root permission issues.
      if (!homePathRef.current) {
        const home = await getHome();
        if (home) {
          homePathRef.current = home;
          homeDriveKeyRef.current = getDriveKey(home);
        }
      }
      if (homePathRef.current && homeDriveKeyRef.current === driveKey) {
        const homeTrash = joinPath(homePathRef.current, TRASH_DIR_NAME);
        await ensureDir(homeTrash);
        trashRootRef.current.set(driveKey, homeTrash);
        return homeTrash;
      }
      const root = driveKeyToRoot(driveKey);
      if (!root) {
        throw new Error("Trash is unavailable.");
      }
      const trashRoot = joinPath(root, TRASH_DIR_NAME);
      await ensureDir(trashRoot);
      trashRootRef.current.set(driveKey, trashRoot);
      return trashRoot;
    },
    [driveKeyToRoot, homeDriveKeyRef, homePathRef, trashRootRef],
  );

  const buildTrashBatchDir = useCallback((root: string) => {
    const nonce = Math.random().toString(36).slice(2, 8);
    return joinPath(root, `delete-${Date.now()}-${nonce}`);
  }, []);

  const runManagedTrashEntries = useCallback(
    async (paths: string[]) => {
      const job = registerTransferJob({
        label: "Delete",
        items: paths,
      });
      try {
        const report = await trashEntries(paths, job.id);
        recordTransferJobOutcome(job.id, {
          skipped: report.skipped,
          failures: report.failures.length,
        });
        return report;
      } catch (error) {
        if (!isManagedJobCancelledError(error)) {
          recordTransferJobOutcome(job.id, { failures: 1 });
        }
        throw error;
      }
    },
    [recordTransferJobOutcome, registerTransferJob],
  );

  const runManagedDeleteEntries = useCallback(
    async (paths: string[]) => {
      const job = registerTransferJob({
        label: "Delete",
        items: paths,
      });
      try {
        const report = await deleteEntriesApi(paths, job.id);
        recordTransferJobOutcome(job.id, {
          skipped: report.skipped,
          failures: report.failures.length,
        });
        return report;
      } catch (error) {
        if (!isManagedJobCancelledError(error)) {
          recordTransferJobOutcome(job.id, { failures: 1 });
        }
        throw error;
      }
    },
    [recordTransferJobOutcome, registerTransferJob],
  );

  const runManagedTrashMove = useCallback(
    async (paths: string[], destination: string) => {
      const job = registerTransferJob({
        label: "Delete",
        items: paths,
      });
      try {
        const report = await transferEntries(
          paths,
          destination,
          {
            mode: "move",
            overwrite: false,
          },
          job.id,
        );
        recordTransferJobOutcome(job.id, {
          moved: report.moved,
          skipped: report.skipped,
          failures: report.failures.length,
        });
        return report;
      } catch (error) {
        if (!isManagedJobCancelledError(error)) {
          recordTransferJobOutcome(job.id, { failures: 1 });
        }
        throw error;
      }
    },
    [recordTransferJobOutcome, registerTransferJob],
  );

  const executeDeleteEntries = useCallback(
    async (paths: string[]): Promise<DeleteReport | null> => {
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;

      log?.("delete entries (trash): %d items", unique.length);
      const promptStore = usePromptStore.getState();

      try {
        const useNativeTrash = isWindowsEnv() && isTauriEnv();
        if (useNativeTrash) {
          // Capture delete time so undo can resolve recycle metadata even if the
          // shell writes recycle info slightly after delete returns.
          const deleteStartedAtMs = Math.max(0, Date.now() - 5_000);
          let report = null;
          try {
            report = await runManagedTrashEntries(unique);
          } catch (error) {
            if (isManagedJobCancelledError(error)) {
              return null;
            }
            promptStore.showPrompt({
              title: "Delete failed",
              content: getManagedJobErrorMessage(
                error,
                "Failed to delete selected items.",
              ),
              confirmLabel: "OK",
              cancelLabel: null,
            });
            return null;
          }

          // Record undo by original paths, not immediate recycle metadata.
          const failedPathSet = new Set(
            report.failedPaths.map((path) => normalizePath(path)),
          );
          const recycledPaths = unique.filter(
            (path) => !failedPathSet.has(normalizePath(path)),
          );
          if (recycledPaths.length > 0) {
            pushUndo({
              type: "recyclePaths",
              paths: recycledPaths,
              deletedAfterMs: deleteStartedAtMs,
            });
          }
          if (report.deleted > 0) {
            await refreshAfterChange();
          }
          if (report.cancelled) {
            return {
              deleted: report.deleted,
              skipped: report.skipped,
              cancelled: true,
              failures: report.failures,
            };
          }

          const remainingPaths = report.failedPaths;
          if (remainingPaths.length > 0) {
            const reasons: string[] = [];
            if (report.failures.length > 0) {
              reasons.push(
                `Recycle Bin unavailable for some items:\n${formatFailures(report.failures)}`,
              );
            }
            if (reasons.length === 0) {
              reasons.push("Some items could not be moved to the Recycle Bin.");
            }
            const countLabel =
              remainingPaths.length === 1
                ? "this item"
                : `${remainingPaths.length} items`;

            return await new Promise<DeleteReport>((resolve) => {
              promptStore.showPrompt({
                title: "Couldn't move items to Recycle Bin",
                content: `${reasons.join("\n\n")}\n\nDelete ${countLabel} permanently instead? This cannot be undone.`,
                confirmLabel: "Delete permanently",
                cancelLabel: "Cancel",
                onConfirm: async () => {
                  let hardReport = null;
                  try {
                    hardReport = await runManagedDeleteEntries(remainingPaths);
                  } catch (error) {
                    if (isManagedJobCancelledError(error)) {
                      resolve({
                        deleted: report.deleted,
                        skipped: report.skipped,
                        cancelled: true,
                        failures: report.failures,
                      });
                      return;
                    }
                    promptStore.showPrompt({
                      title: "Delete failed",
                      content: getManagedJobErrorMessage(
                        error,
                        "Failed to delete selected items.",
                      ),
                      confirmLabel: "OK",
                      cancelLabel: null,
                    });
                    resolve({
                      deleted: report.deleted,
                      skipped: report.skipped,
                      cancelled: false,
                      failures: report.failures,
                    });
                    return;
                  }

                  if (hardReport.deleted > 0) {
                    await refreshAfterChange();
                  }
                  if (hardReport.failures.length > 0 && !hardReport.cancelled) {
                    promptStore.showPrompt({
                      title: "Delete completed with issues",
                      content: formatFailures(hardReport.failures),
                      confirmLabel: "OK",
                      cancelLabel: null,
                    });
                  }
                  resolve({
                    deleted: report.deleted + hardReport.deleted,
                    skipped: report.skipped + hardReport.skipped,
                    cancelled: hardReport.cancelled,
                    failures: [...report.failures, ...hardReport.failures],
                  });
                },
                onCancel: () => {
                  resolve({
                    deleted: report.deleted,
                    skipped: report.skipped,
                    cancelled: false,
                    failures: report.failures,
                  });
                },
              });
            });
          }

          if (report.failures.length > 0) {
            promptStore.showPrompt({
              title: "Delete completed with issues",
              content: formatFailures(report.failures),
              confirmLabel: "OK",
              cancelLabel: null,
            });
          }
          return {
            deleted: report.deleted,
            skipped: report.skipped,
            cancelled: false,
            failures: report.failures,
          };
        }

        const trashGroups = new Map<string, string[]>();
        const trashFailures: string[] = [];
        const moved: UndoTrashEntry[] = [];
        const remaining = new Set<string>();
        const transferFailures: string[] = [];
        let cancelled = false;

        for (const path of unique) {
          try {
            const trashRoot = await resolveTrashRootForPath(path);
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
          const batchDir = buildTrashBatchDir(trashRoot);
          await ensureDir(batchDir);

          try {
            const report = await runManagedTrashMove(trashCandidates, batchDir);
            transferFailures.push(...report.failures);
          } catch (error) {
            if (!isManagedJobCancelledError(error)) {
              throw error;
            }
            cancelled = true;
          }

          // Verify what actually disappeared from the source path before we mark it as trashed.
          const originalMeta = await statEntries(trashCandidates);
          originalMeta.forEach((meta, index) => {
            const path = trashCandidates[index] ?? "";
            if (!path) return;
            if (entryExists(meta)) {
              remaining.add(path);
              return;
            }
            moved.push({
              originalPath: path,
              trashPath: joinPath(batchDir, getPathName(path)),
            });
          });

          if (cancelled) {
            break;
          }
        }

        if (moved.length > 0) {
          pushUndo({ type: "trash", entries: moved });
          await refreshAfterChange();
        }

        const remainingPaths = Array.from(remaining);
        const combinedFailures = [...trashFailures, ...transferFailures];
        if (cancelled) {
          return {
            deleted: moved.length,
            skipped: Math.max(0, unique.length - moved.length),
            cancelled: true,
            failures: combinedFailures,
          };
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
          const countLabel =
            remainingPaths.length === 1
              ? "this item"
              : `${remainingPaths.length} items`;

          return await new Promise<DeleteReport>((resolve) => {
            promptStore.showPrompt({
              title: "Couldn't move items to Trash",
              content: `${reasons.join("\n\n")}\n\nDelete ${countLabel} permanently instead? This cannot be undone.`,
              confirmLabel: "Delete permanently",
              cancelLabel: "Cancel",
              onConfirm: async () => {
                let hardReport = null;
                try {
                  hardReport = await runManagedDeleteEntries(remainingPaths);
                } catch (error) {
                  if (isManagedJobCancelledError(error)) {
                    resolve({
                      deleted: moved.length,
                      skipped: Math.max(0, unique.length - moved.length),
                      cancelled: true,
                      failures: combinedFailures,
                    });
                    return;
                  }
                  promptStore.showPrompt({
                    title: "Delete failed",
                    content: getManagedJobErrorMessage(
                      error,
                      "Failed to delete selected items.",
                    ),
                    confirmLabel: "OK",
                    cancelLabel: null,
                  });
                  resolve({
                    deleted: moved.length,
                    skipped: Math.max(0, unique.length - moved.length),
                    cancelled: false,
                    failures: combinedFailures,
                  });
                  return;
                }

                if (hardReport.deleted > 0) {
                  await refreshAfterChange();
                }
                if (hardReport.failures.length > 0 && !hardReport.cancelled) {
                  promptStore.showPrompt({
                    title: "Delete completed with issues",
                    content: formatFailures(hardReport.failures),
                    confirmLabel: "OK",
                    cancelLabel: null,
                  });
                }
                resolve({
                  deleted: moved.length + hardReport.deleted,
                  skipped: Math.max(
                    0,
                    unique.length - moved.length - hardReport.deleted,
                  ),
                  cancelled: hardReport.cancelled,
                  failures: [...combinedFailures, ...hardReport.failures],
                });
              },
              onCancel: () => {
                resolve({
                  deleted: moved.length,
                  skipped: Math.max(0, unique.length - moved.length),
                  cancelled: false,
                  failures: combinedFailures,
                });
              },
            });
          });
        }

        if (combinedFailures.length > 0) {
          promptStore.showPrompt({
            title: "Delete completed with issues",
            content: formatFailures(combinedFailures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        return {
          deleted: moved.length,
          skipped: Math.max(0, unique.length - moved.length),
          cancelled: false,
          failures: combinedFailures,
        };
      } catch (error) {
        if (isManagedJobCancelledError(error)) {
          return null;
        }
        promptStore.showPrompt({
          title: "Delete failed",
          content: getManagedJobErrorMessage(
            error,
            "Failed to delete selected items.",
          ),
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return null;
      }
    },
    [
      buildTrashBatchDir,
      log,
      pushUndo,
      refreshAfterChange,
      resolveTrashRootForPath,
      runManagedDeleteEntries,
      runManagedTrashEntries,
      runManagedTrashMove,
    ],
  );

  const deleteEntriesInView = useCallback(
    async (paths: string[]): Promise<DeleteReport | null> => {
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;

      activeDeleteRequestCountRef.current += 1;
      deleteInFlightRef.current = true;

      try {
        return await executeDeleteEntries(unique);
      } finally {
        activeDeleteRequestCountRef.current = Math.max(
          activeDeleteRequestCountRef.current - 1,
          0,
        );
        deleteInFlightRef.current = activeDeleteRequestCountRef.current > 0;
      }
    },
    [deleteInFlightRef, executeDeleteEntries],
  );

  return { deleteEntriesInView };
};
