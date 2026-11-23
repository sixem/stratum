// Selection, keyboard movement, and selected-item details for indexed search.
//
// This hook is deliberately UI-adjacent: it owns refs used for keyboard
// scrolling, but keeps backend detail loading and open-path failures out of the
// render-only components.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

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
import { useIndexedResultFocus } from "./useIndexedResultFocus";
import { updateIndexedCopySelection, type IndexedCopyModifiers, type IndexedCopySelection } from "./indexedCopySelection";

type UseIndexedSearchSelectionParams = {
  driveStatuses: IndexedDriveStatus[];
  open: boolean;
  results: IndexedPathMatch[];
  query: string;
  hasMore: boolean;
  loadMore: () => void;
  resultsViewportRef: RefObject<HTMLDivElement | null>;
  onOpenFolder: (path: string) => void;
};

export const useIndexedSearchSelection = ({
  driveStatuses,
  open,
  results,
  query,
  hasMore,
  loadMore,
  resultsViewportRef,
  onOpenFolder,
}: UseIndexedSearchSelectionParams) => {
  const { registerResultRow, revealResult } = useIndexedResultFocus(resultsViewportRef);
  const [selection, setSelection] = useState<IndexedSelection | null>(null);
  const [copySelection, setCopySelection] = useState<IndexedCopySelection | null>(null);
  const [selectedResultMeta, setSelectedResultMeta] = useState<EntryMeta | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const resultIndexes = useMemo(() => new Map(results.map(({ path }, index) => [path, index])), [results]);
  const selectedResultIndex = selection?.kind === "result" ? resultIndexes.get(selection.path) ?? -1 : -1;
  const selectedResult = results[selectedResultIndex] ?? null;
  const copyPaths = useMemo(() => copySelection && new Set(
    [...copySelection.paths].filter((path) => resultIndexes.has(path)),
  ), [copySelection, resultIndexes]);

  useEffect(() => {
    setCopySelection(null);
  }, [open, query]);

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
        if (resultIndexes.has(current.path)) return current;
        const pathKey = normalizeIndexedPathKey(current.path);
        const matchingResult = results.find(
          (result) => normalizeIndexedPathKey(result.path) === pathKey,
        );
        if (matchingResult) return { kind: "result", path: matchingResult.path };
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
  }, [driveStatuses, open, resultIndexes, results]);

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
    setSelection((current) => current?.kind === "result" && current.path === result.path
      ? current : { kind: "result", path: result.path });
  }, []);

  const selectResultForCopy = useCallback((result: IndexedPathMatch, modifiers: IndexedCopyModifiers = {}) => {
    if (modifiers.range || modifiers.toggle) {
      setCopySelection((current) => updateIndexedCopySelection(
        current, result.path, selectedResultPath, results, resultIndexes, modifiers,
      ));
    } else {
      setCopySelection(null);
    }
    selectResult(result);
  }, [resultIndexes, results, selectResult, selectedResultPath]);

  const selectDrive = useCallback((drivePath: string) => {
    setCopySelection(null);
    setSelection({ kind: "drive", drivePath });
  }, []);

  const moveSelection = useCallback(
    (direction: 1 | -1, focusRow: boolean, range: boolean) => {
      if (results.length === 0) return;

      if (hasMore && direction > 0 && selectedResultIndex === results.length - 1) {
        loadMore();
        return;
      }
      if (hasMore && direction < 0 && selectedResultIndex === 0) return;

      const nextIndex =
        selectedResultIndex < 0
          ? direction > 0
            ? 0
            : results.length - 1
          : (selectedResultIndex + direction + results.length) % results.length;
      const nextResult = results[nextIndex];
      if (!nextResult) return;

      selectResultForCopy(nextResult, { range });
      revealResult(nextResult.path, nextIndex, focusRow);
    },
    [hasMore, loadMore, results, revealResult, selectedResultIndex, selectResultForCopy],
  );

  const focusSelectedResult = useCallback(() => {
    if (selectedResult) revealResult(selectedResult.path, selectedResultIndex, true);
  }, [revealResult, selectedResult, selectedResultIndex]);

  const handleSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement | HTMLButtonElement>) => {
      if (event.nativeEvent.isComposing || event.altKey) return;
      const focusRow = event.currentTarget instanceof HTMLButtonElement;
      if (focusRow && (event.ctrlKey || event.metaKey) && event.key === " " && selectedResult) {
        event.preventDefault();
        if (!event.repeat) selectResultForCopy(selectedResult, { toggle: true });
        return;
      }
      if (event.ctrlKey || event.metaKey) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(
          event.key === "ArrowDown" ? 1 : -1,
          focusRow,
          focusRow && event.shiftKey,
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
    [handleOpenSelectedResult, moveSelection, results, selectedResult, selectResult, selectResultForCopy],
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
    registerResultRow,
    focusSelectedResult,
    copyPaths,
    selectedDrive,
    selectedResult,
    selectedResultIndex,
    selectedResultMeta: selectedResultMeta?.path === selectedResultPath ? selectedResultMeta : null,
    selectionError,
    selectDrive,
    selectResult,
    selectResultForCopy,
  };
};
