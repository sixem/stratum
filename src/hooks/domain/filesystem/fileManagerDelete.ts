// Handles delete and trash operations for the file manager.
import { useCallback } from "react";
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
  entryExists,
  formatFailures,
  getDriveKey,
  getPathName,
  joinPath,
  normalizePath,
  tabLabel,
  toMessage,
} from "@/lib";
import { usePromptStore } from "@/modules";
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

  const deleteEntriesInView = useCallback(
    async (paths: string[]): Promise<DeleteReport | null> => {
      if (deleteInFlightRef.current) return null;
      const unique = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      if (unique.length === 0) return null;
      log?.("delete entries (trash): %d items", unique.length);
      deleteInFlightRef.current = true;
      try {
        const useNativeTrash = isWindowsEnv() && isTauriEnv();
        if (useNativeTrash) {
          // Capture delete time so undo can resolve recycle metadata even if the
          // shell writes recycle info slightly after delete returns.
          const deleteStartedAtMs = Math.max(0, Date.now() - 5_000);
          let report = null;
          try {
            report = await trashEntries(unique);
          } catch (error) {
            usePromptStore.getState().showPrompt({
              title: "Delete failed",
              content: toMessage(error, "Failed to delete selected items."),
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
              usePromptStore.getState().showPrompt({
                title: "Couldn't move items to Recycle Bin",
                content: `${reasons.join("\n\n")}\n\nDelete ${countLabel} permanently instead? This cannot be undone.`,
                confirmLabel: "Delete permanently",
                cancelLabel: "Cancel",
                onConfirm: async () => {
                  let hardReport = null;
                  try {
                    hardReport = await deleteEntriesApi(remainingPaths);
                  } catch (error) {
                    usePromptStore.getState().showPrompt({
                      title: "Delete failed",
                      content: toMessage(error, "Failed to delete selected items."),
                      confirmLabel: "OK",
                      cancelLabel: null,
                    });
                    resolve({
                      deleted: report.deleted,
                      skipped: report.skipped,
                      failures: report.failures,
                    });
                    return;
                  }
                  if (hardReport.failures.length > 0) {
                    usePromptStore.getState().showPrompt({
                      title: "Delete completed with issues",
                      content: formatFailures(hardReport.failures),
                      confirmLabel: "OK",
                      cancelLabel: null,
                    });
                  }
                  if (hardReport.deleted > 0) {
                    await refreshAfterChange();
                  }
                  resolve({
                    deleted: report.deleted + hardReport.deleted,
                    skipped: report.skipped + hardReport.skipped,
                    failures: [...report.failures, ...hardReport.failures],
                  });
                },
                onCancel: () => {
                  resolve({
                    deleted: report.deleted,
                    skipped: report.skipped,
                    failures: report.failures,
                  });
                },
              });
            });
          }
          if (report.failures.length > 0) {
            usePromptStore.getState().showPrompt({
              title: "Delete completed with issues",
              content: formatFailures(report.failures),
              confirmLabel: "OK",
              cancelLabel: null,
            });
          }
          return {
            deleted: report.deleted,
            skipped: report.skipped,
            failures: report.failures,
          };
        }

        const trashGroups = new Map<string, string[]>();
        const trashFailures: string[] = [];
        const moved: UndoTrashEntry[] = [];
        const remaining = new Set<string>();
        const transferFailures: string[] = [];

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

          const report = await transferEntries(trashCandidates, batchDir, {
            mode: "move",
            overwrite: false,
          });
          transferFailures.push(...report.failures);

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
        }

        if (moved.length > 0) {
          pushUndo({ type: "trash", entries: moved });
          await refreshAfterChange();
        }

        const remainingPaths = Array.from(remaining);

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
            usePromptStore.getState().showPrompt({
              title: "Couldn't move items to Trash",
              content: `${reasons.join("\n\n")}\n\nDelete ${countLabel} permanently instead? This cannot be undone.`,
              confirmLabel: "Delete permanently",
              cancelLabel: "Cancel",
              onConfirm: async () => {
                let hardReport = null;
                try {
                  hardReport = await deleteEntriesApi(remainingPaths);
                } catch (error) {
                  usePromptStore.getState().showPrompt({
                    title: "Delete failed",
                    content: toMessage(error, "Failed to delete selected items."),
                    confirmLabel: "OK",
                    cancelLabel: null,
                  });
                  resolve({
                    deleted: moved.length,
                    skipped: Math.max(0, unique.length - moved.length),
                    failures: transferFailures,
                  });
                  return;
                }
                if (hardReport.failures.length > 0) {
                  usePromptStore.getState().showPrompt({
                    title: "Delete completed with issues",
                    content: formatFailures(hardReport.failures),
                    confirmLabel: "OK",
                    cancelLabel: null,
                  });
                }
                if (hardReport.deleted > 0) {
                  await refreshAfterChange();
                }
                resolve({
                  deleted: moved.length + hardReport.deleted,
                  skipped: Math.max(
                    0,
                    unique.length - moved.length - hardReport.deleted,
                  ),
                  failures: [...transferFailures, ...hardReport.failures],
                });
              },
              onCancel: () => {
                resolve({
                  deleted: moved.length,
                  skipped: Math.max(0, unique.length - moved.length),
                  failures: transferFailures,
                });
              },
            });
          });
        }

        if (transferFailures.length > 0) {
          usePromptStore.getState().showPrompt({
            title: "Delete completed with issues",
            content: formatFailures(transferFailures),
            confirmLabel: "OK",
            cancelLabel: null,
          });
        }
        return {
          deleted: moved.length,
          skipped: Math.max(0, unique.length - moved.length),
          failures: transferFailures,
        };
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Failed to delete selected items.";
        usePromptStore.getState().showPrompt({
          title: "Delete failed",
          content: message,
          confirmLabel: "OK",
          cancelLabel: null,
        });
        return null;
      } finally {
        deleteInFlightRef.current = false;
      }
    },
    [
      buildTrashBatchDir,
      deleteInFlightRef,
      log,
      pushUndo,
      refreshAfterChange,
      resolveTrashRootForPath,
    ],
  );

  return { deleteEntriesInView };
};
