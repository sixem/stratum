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
};

export const useIndexedSearchSelection = ({
  driveStatuses,
  open,
  results,
}: UseIndexedSearchSelectionParams) => {
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [selection, setSelection] = useState<IndexedSelection | null>(null);
  const [selectedResultMeta, setSelectedResultMeta] = useState<EntryMeta | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  useEffect(() => {
    resultRefs.current.length = results.length;
  }, [results.length]);

  useEffect(() => {
    if (open) return;

    setSelectedIndex(-1);
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
          return { kind: "result", path: matchingResult.path };
        }
      }

      if (current?.kind === "drive") {
        const matchingDrive = driveStatuses.find(
          (status) =>
            normalizeDrivePathKey(status.drivePath) === normalizeDrivePathKey(current.drivePath),
        );
        if (matchingDrive) {
          return { kind: "drive", drivePath: matchingDrive.drivePath };
        }
      }

      const firstDrive = driveStatuses[0];
      if (firstDrive) {
        return { kind: "drive", drivePath: firstDrive.drivePath };
      }

      const firstResult = results[0];
      if (firstResult) {
        return { kind: "result", path: firstResult.path };
      }

      return null;
    });
  }, [driveStatuses, open, results]);

  useEffect(() => {
    if (!open) return;

    if (selection?.kind !== "result") {
      setSelectedIndex(-1);
      return;
    }

    const nextIndex = results.findIndex(
      (result) =>
        normalizeIndexedPathKey(result.path) === normalizeIndexedPathKey(selection.path),
    );
    setSelectedIndex(nextIndex);
  }, [open, results, selection]);

  useEffect(() => {
    if (!open || selectedIndex < 0) return;
    resultRefs.current[selectedIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open || selection?.kind !== "result") {
      setSelectedResultMeta(null);
      setSelectionError(null);
      return;
    }

    let active = true;
    setSelectionError(null);

    void statEntries([selection.path])
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
  }, [open, selection]);

  const handleOpenSelectedResult = useCallback(async (path: string) => {
    setSelectionError(null);
    try {
      await openPath(path);
    } catch (error) {
      setSelectionError(
        error instanceof Error ? error.message : "Unable to open the selected path.",
      );
    }
  }, []);

  const selectResult = useCallback((result: IndexedPathMatch, index: number) => {
    setSelectedIndex(index);
    setSelectionError(null);
    setSelection({ kind: "result", path: result.path });
  }, []);

  const selectDrive = useCallback((drivePath: string) => {
    setSelection({ kind: "drive", drivePath });
  }, []);

  const moveSelection = useCallback(
    (direction: 1 | -1) => {
      if (results.length === 0) {
        setSelectedIndex(-1);
        return;
      }

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

      selectResult(nextResult, nextIndex);
    },
    [results, selectResult, selection],
  );

  const handleQueryKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
      }
    },
    [moveSelection],
  );

  const selectedDrive =
    selection?.kind === "drive"
      ? driveStatuses.find(
          (status) =>
            normalizeDrivePathKey(status.drivePath) === normalizeDrivePathKey(selection.drivePath),
        ) ?? null
      : null;
  const selectedResult =
    selection?.kind === "result"
      ? results.find(
          (result) =>
            normalizeIndexedPathKey(result.path) === normalizeIndexedPathKey(selection.path),
        ) ?? null
      : null;

  return {
    handleOpenSelectedResult,
    handleQueryKeyDown,
    resultRefs,
    selectedDrive,
    selectedIndex,
    selectedResult,
    selectedResultMeta,
    selection,
    selectionError,
    selectDrive,
    selectResult,
  };
};
