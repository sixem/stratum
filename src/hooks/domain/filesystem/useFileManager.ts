// Filesystem facade: composes focused hooks for loading, metadata, mutations, and bootstrap.
import { useCallback, useRef } from "react";
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

  return {
    currentPath: directoryLoader.currentPath,
    parentPath: directoryLoader.parentPath,
    entries: directoryLoader.entries,
    totalCount: directoryLoader.totalCount,
    places: fsBootstrap.places,
    placesLoaded: fsBootstrap.placesLoaded,
    drives: fsBootstrap.drives,
    driveInfo: fsBootstrap.driveInfo,
    entryMeta: metaCache.entryMeta,
    loading: directoryLoader.loading,
    suppressUndoPresence: fileMutations.suppressUndoPresence,
    status: directoryLoader.status,
    loadDir: directoryLoader.loadDir,
    clearDir: directoryLoader.clearDir,
    openEntry: openEntryInView,
    refresh,
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
    undo: fileMutations.undoLastAction,
    canUndo: fileMutations.canUndo,
  };
}
