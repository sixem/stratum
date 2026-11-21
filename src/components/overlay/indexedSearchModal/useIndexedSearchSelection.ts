// Selection, keyboard movement, and selected-item details for indexed search.
//
// This hook is deliberately UI-adjacent: it owns refs used for keyboard
// scrolling, but keeps backend detail loading and open-path failures out of the
// render-only components.
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { openPath, statEntries } from "@/api";
import type {
  EntryMeta,
  IndexedDriveStatus,
  IndexedPathMatch,
} from "@/types";
import {
  normalizeDrivePathKey,
  normalizeIndexedPathKey,
  type IndexedSelection,
} from "./indexedSearchModalTypes";

type UseIndexedSearchSelectionParams = {
  driveStatuses: IndexedDriveStatus[];
  open: boolean;
  results: IndexedPathMatch[];
  onOpenFolder: (path: string) => void;
};

export const useIndexedSearchSelection = ({
  driveStatuses,
  open,
  results,
  onOpenFolder,
}: UseIndexedSearchSelectionParams) => {
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selection, setSelection] = useState<IndexedSelection | null>(null);
  const [selectedResultMeta, setSelectedResultMeta] = useState<EntryMeta | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const selectedResult =
    selection?.kind === "result"
      ? results.find(
          (result) =>
            normalizeIndexedPathKey(result.path) === normalizeIndexedPathKey(selection.path),
        ) ?? null
      : null;

  useEffect(() => {
    resultRefs.current.length = results.length;
  }, [results.length]);

  useEffect(() => {
    if (open) return;

    setSelection(null);
    setSelectedResultMeta(null);
    setSelectionError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    setSelection((current) => {
      if (current?.kind === "result") {
        const matchingResult = results.find(
          (result) =>
            normalizeIndexedPathKey(result.path) === normalizeIndexedPathKey(current.path),
        );
        if (matchingResult) {
          return current.path === matchingResult.path
            ? current
            : { kind: "result", path: matchingResult.path };
        }
      }

      if (current?.kind === "drive") {
        const matchingDrive = driveStatuses.find(
          (status) =>
            normalizeDrivePathKey(status.drivePath) === normalizeDrivePathKey(current.drivePath),
        );
        if (matchingDrive) {
          return current.drivePath === matchingDrive.drivePath
            ? current
            : { kind: "drive", drivePath: matchingDrive.drivePath };
        }
      }

      const firstResult = results[0];
      if (firstResult) {
        return { kind: "result", path: firstResult.path };
      }

      return null;
    });
  }, [driveStatuses, open, results]);

  const selectedResultPath = selectedResult?.path;

  useEffect(() => {
    setSelectedResultMeta(null);
    setSelectionError(null);
    if (!open || !selectedResultPath) {
      return;
    }

    let active = true;

    void statEntries([selectedResultPath])
      .then((entries) => {
        if (!active) return;
        setSelectedResultMeta(entries[0] ?? null);
      })
      .catch((error) => {
        if (!active) return;
        setSelectionError(
          error instanceof Error ? error.message : "Unable to load file details.",
        );
      });

    return () => {
      active = false;
    };
  }, [open, selectedResultPath]);

  const handleOpenSelectedResult = useCallback(async (result: IndexedPathMatch) => {
    setSelectionError(null);
    if (result.kind === "directory") {
      onOpenFolder(result.path);
      return;
    }
    try {
      await openPath(result.path);
    } catch (error) {
      setSelectionError(
        error instanceof Error ? error.message : "Unable to open the selected path.",
      );
    }
  }, [onOpenFolder]);

  const selectResult = useCallback((result: IndexedPathMatch) => {
    setSelectionError(null);
    setSelection({ kind: "result", path: result.path });
  }, []);

  const selectDrive = useCallback((drivePath: string) => {
    setSelection({ kind: "drive", drivePath });
  }, []);

  const moveSelection = useCallback(
    (direction: 1 | -1, focusRow: boolean) => {
      if (results.length === 0) return;

      const currentIndex =
        selection?.kind === "result"
          ? results.findIndex(
              (result) =>
                normalizeIndexedPathKey(result.path) ===
                normalizeIndexedPathKey(selection.path),
            )
          : -1;
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : results.length - 1
          : (currentIndex + direction + results.length) % results.length;
      const nextResult = results[nextIndex];
      if (!nextResult) return;

      selectResult(nextResult);
      const row = resultRefs.current[nextIndex];
      if (focusRow) row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
    },
    [results, selectResult, selection],
  );

  const handleSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement | HTMLButtonElement>) => {
      if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(
          event.key === "ArrowDown" ? 1 : -1,
          event.currentTarget instanceof HTMLButtonElement,
        );
        return;
      }

      const resultToOpen = selectedResult ?? results[0];
      if (event.key === "Enter" && resultToOpen) {
        event.preventDefault();
        if (event.repeat) return;
        selectResult(resultToOpen);
        void handleOpenSelectedResult(resultToOpen);
      }
    },
    [handleOpenSelectedResult, moveSelection, results, selectedResult, selectResult],
  );

  const selectedDrive =
    selection?.kind === "drive"
      ? driveStatuses.find(
          (status) =>
            normalizeDrivePathKey(status.drivePath) === normalizeDrivePathKey(selection.drivePath),
        ) ?? null
      : null;

  return {
    handleOpenSelectedResult,
    handleSearchKeyDown,
    resultRefs,
    selectedDrive,
    selectedResult,
    selectedResultMeta: selectedResultMeta?.path === selectedResultPath ? selectedResultMeta : null,
    selectionError,
    selectDrive,
    selectResult,
  };
};
