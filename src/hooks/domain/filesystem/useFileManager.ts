// Filesystem facade: composes focused hooks for loading, metadata, mutations, and bootstrap.
import { useCallback, useMemo, useRef } from "react";
import { openPath } from "@/api";
import { makeDebug, toMessage } from "@/lib";
import { usePromptStore } from "@/modules";
import { useDirectoryLoader } from "./useDirectoryLoader";
import { useEntryMetaCache } from "./useEntryMetaCache";
import { useFileMutations } from "./useFileMutations";
import { useFsBootstrap } from "./useFsBootstrap";

const log = makeDebug("fs");
const perf = makeDebug("perf:fs");

export function useFileManager() {
  // Shared request id allows metadata requests to ignore stale directory loads.
  const loadIdRef = useRef(0);

  const reportError = useCallback((title: string, message: string) => {
    usePromptStore.getState().showPrompt({
      title,
      content: message,
      confirmLabel: "OK",
      cancelLabel: null,
    });
  }, []);

  const metaCache = useEntryMetaCache({ loadIdRef, perf });

  const directoryLoader = useDirectoryLoader({
    loadIdRef,
    primeEntryMeta: metaCache.primeEntryMeta,
    reportError,
    log,
    perf,
  });

  const fsBootstrap = useFsBootstrap({
    setLoading: directoryLoader.setLoading,
    setStatus: directoryLoader.setStatus,
    reportError,
  });

  const fileMutations = useFileMutations({
    currentPathRef: directoryLoader.currentPathRef,
    refreshAfterChange: directoryLoader.refreshAfterChange,
    log,
  });

  const openEntryInView = useCallback(
    async (path: string) => {
      const target = path.trim();
      if (!target) return;
      try {
        await openPath(target);
      } catch (error) {
        reportError(
          "Couldn't open item",
          `Failed to open ${target}: ${toMessage(error, "unknown error")}`,
        );
      }
    },
    [reportError],
  );

  const refresh = useCallback(async () => {
    const target = directoryLoader.currentPathRef.current;
    if (!target) return;
    log("refresh start: %s", target);
    const start = perf.enabled ? performance.now() : 0;
    await Promise.all([
      directoryLoader.loadDir(target, { force: true }),
      fsBootstrap.refreshDriveInfo(),
    ]);
    if (perf.enabled) {
      perf(
        "refresh complete: %s in %dms",
        target,
        Math.round(performance.now() - start),
      );
    }
  }, [directoryLoader.currentPathRef, directoryLoader.loadDir, fsBootstrap.refreshDriveInfo]);

  const status = useMemo(() => {
    const baseStatus = directoryLoader.status;
    const activityLabel = fsBootstrap.indexedSearchStatus?.activityLabel?.trim();
    const indexedSearchState = fsBootstrap.indexedSearchStatus?.state;
    if (baseStatus.level !== "idle") {
      return baseStatus;
    }
    if (!activityLabel) {
      return baseStatus;
    }
    return {
      level:
        indexedSearchState === "starting" || indexedSearchState === "scanning"
          ? ("loading" as const)
          : ("idle" as const),
      message: activityLabel,
    };
  }, [directoryLoader.status, fsBootstrap.indexedSearchStatus]);

  return {
    currentPath: directoryLoader.currentPath,
    parentPath: directoryLoader.parentPath,
    entries: directoryLoader.entries,
    totalCount: directoryLoader.totalCount,
    places: fsBootstrap.places,
    placesLoaded: fsBootstrap.placesLoaded,
    drives: fsBootstrap.drives,
    driveInfo: fsBootstrap.driveInfo,
    indexedSearchStatus: fsBootstrap.indexedSearchStatus,
    entryMeta: metaCache.entryMeta,
    loading: directoryLoader.loading,
    suppressUndoPresence: fileMutations.suppressUndoPresence,
    pendingDeletePaths: fileMutations.pendingDeletePaths,
    status,
    loadDir: directoryLoader.loadDir,
    clearDir: directoryLoader.clearDir,
    openEntry: openEntryInView,
    refresh,
    refreshDriveInfo: fsBootstrap.refreshDriveInfo,
    peekDirCache: directoryLoader.peekDirCache,
    requestEntryMeta: metaCache.requestEntryMeta,
    flushEntryMeta: metaCache.flushEntryMeta,
    deleteEntries: fileMutations.deleteEntriesInView,
    duplicateEntries: fileMutations.duplicateEntriesInView,
    pasteEntries: fileMutations.pasteEntriesInView,
    createFolder: fileMutations.createFolderInView,
    createFile: fileMutations.createFileInView,
    renameEntry: fileMutations.renameEntryInView,
    renameEntries: fileMutations.renameEntriesInView,
    recordMoveUndo: fileMutations.recordMoveUndo,
    setTransferInFlight: fileMutations.setTransferInFlight,
    undo: fileMutations.undoLastAction,
    canUndo: fileMutations.canUndo,
  };
}
