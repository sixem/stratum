// Handles delete and trash operations for the file manager.
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import {
  deleteEntries as deleteEntriesApi,
  ensureDir,
  getHome,
  transferEntries,
  trashEntries,
} from "@/api";
import { isManagedJobCancelledError } from "@/hooks/domain/filesystem/transferJobErrors";
import { getDriveKey, joinPath } from "@/lib";
import { usePromptStore, useTransferStore } from "@/modules";
import type { DeleteReport, TransferReport, TrashReport } from "@/types";
import type { UndoAction } from "./fileManagerUndo";
import { runManagedTrashMoveDelete } from "./delete/runManagedTrashMoveDelete";
import { runNativeRecycleDelete } from "./delete/runNativeRecycleDelete";

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

const isNativeRecycleDeleteEnvironment = () => {
  if (typeof navigator === "undefined") return false;
  return /windows/i.test(navigator.userAgent) &&
    ("__TAURI_INTERNALS__" in globalThis || "__TAURI__" in globalThis);
};

const normalizeDeletePaths = (paths: string[]) =>
  Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));

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

  const registerManagedDeleteJob = useCallback(
    (label: string, items: string[]) => {
      const job = registerTransferJob({ label, items });
      const recordOutcome = (patch: {
        moved?: number;
        skipped?: number;
        failures?: number;
      }) => {
        recordTransferJobOutcome(job.id, patch);
      };
      return { jobId: job.id, recordOutcome };
    },
    [recordTransferJobOutcome, registerTransferJob],
  );

  const runManagedTrashEntries = useCallback(
    async (paths: string[]): Promise<TrashReport> => {
      const managedJob = registerManagedDeleteJob("Delete", paths);
      try {
        const report = await trashEntries(paths, managedJob.jobId);
        managedJob.recordOutcome({
          skipped: report.skipped,
          failures: report.failures.length,
        });
        return report;
      } catch (error) {
        if (!isManagedJobCancelledError(error)) {
          managedJob.recordOutcome({ failures: 1 });
        }
        throw error;
      }
    },
    [registerManagedDeleteJob],
  );

  const runManagedDeleteEntries = useCallback(
    async (paths: string[]): Promise<DeleteReport> => {
      const managedJob = registerManagedDeleteJob("Delete", paths);
      try {
        const report = await deleteEntriesApi(paths, managedJob.jobId);
        managedJob.recordOutcome({
          skipped: report.skipped,
          failures: report.failures.length,
        });
        return report;
      } catch (error) {
        if (!isManagedJobCancelledError(error)) {
          managedJob.recordOutcome({ failures: 1 });
        }
        throw error;
      }
    },
    [registerManagedDeleteJob],
  );

  const runManagedTrashMove = useCallback(
    async (paths: string[], destination: string): Promise<TransferReport> => {
      const managedJob = registerManagedDeleteJob("Delete", paths);
      try {
        const report = await transferEntries(
          paths,
          destination,
          {
            mode: "move",
            overwrite: false,
          },
          managedJob.jobId,
        );
        managedJob.recordOutcome({
          moved: report.moved,
          skipped: report.skipped,
          failures: report.failures.length,
        });
        return report;
      } catch (error) {
        if (!isManagedJobCancelledError(error)) {
          managedJob.recordOutcome({ failures: 1 });
        }
        throw error;
      }
    },
    [registerManagedDeleteJob],
  );

  const executeDeleteEntries = useCallback(
    async (paths: string[]): Promise<DeleteReport | null> => {
      const unique = normalizeDeletePaths(paths);
      if (unique.length === 0) return null;

      log?.("delete entries (trash): %d items", unique.length);
      const promptStore = usePromptStore.getState();
      const context = {
        promptStore,
        pushUndo,
        refreshAfterChange,
      };
      const operations = {
        runManagedTrashEntries,
        runManagedDeleteEntries,
        runManagedTrashMove,
      };

      if (isNativeRecycleDeleteEnvironment()) {
        return runNativeRecycleDelete({
          paths: unique,
          operations,
          context,
        });
      }

      return runManagedTrashMoveDelete({
        paths: unique,
        operations,
        context,
        locations: {
          resolveTrashRootForPath,
          buildTrashBatchDir,
        },
      });
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
      const unique = normalizeDeletePaths(paths);
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
