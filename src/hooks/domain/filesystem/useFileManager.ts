// Filesystem facade: composes focused hooks for loading, metadata, mutations, and bootstrap.
import { useCallback, useMemo, useRef } from "react";
import { openPath } from "@/api";
import { makeDebug, tabLabel, toMessage } from "@/lib";
import { usePromptStore } from "@/modules";
import { useSessionStore } from "@/modules/sessionStore";
import { useDirectoryLoader } from "./useDirectoryLoader";
import { useEntryMetaCache } from "./useEntryMetaCache";
import { useFileActivity } from "./useFileActivity";
import { useFileMutations } from "./useFileMutations";
import { useFsBootstrap } from "./useFsBootstrap";
import { fileManagerStatus } from "./fileManagerStatus";

const log = makeDebug("fs");
const perf = makeDebug("perf:fs");
const getRestoreRevision = () => useSessionStore.getState().restoreRevision;

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
    setMetaListingPending: metaCache.setMetaListingPending,
    reportError,
    getRestoreRevision,
    log,
    perf,
  });

  const fsBootstrap = useFsBootstrap({
    reportError,
  });

  const { message: fileActivity, beginFileActivity } = useFileActivity();
  const fileMutations = useFileMutations({
    beginFileActivity,
    currentPathRef: directoryLoader.currentPathRef,
    refreshAfterChange: directoryLoader.refreshAfterChange,
    log,
  });

  const openEntryInView = useCallback(
    async (path: string) => {
      const target = path.trim();
      if (!target) return;
      const finish = beginFileActivity(`Opening ${tabLabel(target)}`);
      try {
        await openPath(target);
      } catch (error) {
        reportError(
          "Couldn't open item",
          `Failed to open ${target}: ${toMessage(error, "unknown error")}`,
        );
      } finally {
        finish();
      }
    },
    [beginFileActivity, reportError],
  );

  const refresh = useCallback(async () => {
    const start = perf.enabled ? performance.now() : 0;
    await Promise.all([
      directoryLoader.refresh(),
      fsBootstrap.refreshDriveInfo(),
    ]);
    if (perf.enabled) {
      perf(
        "refresh complete in %dms",
        Math.round(performance.now() - start),
      );
    }
  }, [directoryLoader.refresh, fsBootstrap.refreshDriveInfo]);

  const indexState = fsBootstrap.indexedSearchStatus?.state;
  const indexActivity = fsBootstrap.indexedSearchStatus?.activityLabel;
  const status = useMemo(() => fileManagerStatus({ loadingPath: directoryLoader.loadingPath,
    fileActivity, placesLoaded: fsBootstrap.placesLoaded, indexState, indexActivity }),
  [directoryLoader.loadingPath, fileActivity, fsBootstrap.placesLoaded, indexState, indexActivity]);

  return {
    currentPath: directoryLoader.currentPath,
    parentPath: directoryLoader.parentPath,
    entries: directoryLoader.entries,
    displayedQueryKey: directoryLoader.displayedQueryKey,
    confirmedQueryKey: directoryLoader.confirmedQueryKey,
    totalCount: directoryLoader.totalCount,
    places: fsBootstrap.places,
    placesLoaded: fsBootstrap.placesLoaded,
    drives: fsBootstrap.drives,
    drivesLoaded: fsBootstrap.drivesLoaded,
    driveInfoLoaded: fsBootstrap.driveInfoLoaded,
    driveInfo: fsBootstrap.driveInfo,
    indexedSearchStatus: fsBootstrap.indexedSearchStatus,
    entryMeta: metaCache.entryMeta,
    loading: directoryLoader.loadingPath !== null,
    loadingPath: directoryLoader.loadingPath,
    failedPath: directoryLoader.failedPath,
    suppressUndoPresence: fileMutations.suppressUndoPresence,
    status,
    loadDir: directoryLoader.loadDir,
    clearDir: directoryLoader.clearDir,
    openEntry: openEntryInView,
    beginFileActivity,
    refresh,
    refreshAfterChange: directoryLoader.refreshAfterChange,
    refreshDriveInfo: fsBootstrap.refreshDriveInfo,
    peekDirCache: directoryLoader.peekDirCache,
    requestEntryMeta: metaCache.requestEntryMeta,
    flushEntryMeta: metaCache.flushEntryMeta,
    deleteEntries: fileMutations.deleteEntriesInView,
    copyEntries: fileMutations.copyEntriesToFolder,
    duplicateEntries: fileMutations.duplicateEntriesInView,
    moveEntries: fileMutations.moveEntriesInView,
    createFolderWithSelection: fileMutations.createFolderWithSelection,
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
