// Handles view selection state for list and grid views.
import { useCallback, useMemo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { FileEntry } from "@/types";
import { useSelection } from "./useSelection";

type SelectionTarget = {
  path: string;
  isDir: boolean;
};

type UseFileViewSelectionOptions = {
  entries: FileEntry[];
  parentPath: string | null;
  resetKey: string;
};

export const useFileViewSelection = ({
  entries,
  parentPath,
  resetKey,
}: UseFileViewSelectionOptions) => {
  const { selectionItems, entryByPath } = useMemo(() => {
    // Build selection order and lookup map together to avoid extra passes.
    const nextItems: string[] = [];
    const nextEntryMap = new Map<string, FileEntry>();
    if (parentPath) {
      nextItems.push(parentPath);
    }
    entries.forEach((entry) => {
      nextItems.push(entry.path);
      nextEntryMap.set(entry.path, entry);
    });
    return { selectionItems: nextItems, entryByPath: nextEntryMap };
  }, [entries, parentPath]);

  const selectionIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    selectionItems.forEach((path, index) => map.set(path, index));
    return map;
  }, [selectionItems]);

  const {
    selected,
    selectItem,
    clearSelection,
    setSelection,
    getAnchorPath,
    getSelectionSnapshot,
  } = useSelection({
    items: selectionItems,
    resetKey,
  });

  const getSelectionIndex = useCallback(() => {
    if (selected.size === 0) return -1;
    const anchor = getAnchorPath();
    if (anchor && selected.has(anchor)) {
      const index = selectionIndexMap.get(anchor);
      if (index != null) return index;
    }
    for (const path of selected) {
      const index = selectionIndexMap.get(path);
      if (index != null) return index;
    }
    return -1;
  }, [getAnchorPath, selected, selectionIndexMap]);

  const handleSelectItem = useCallback(
    (path: string, index: number, event: ReactMouseEvent) => {
      selectItem(path, index, event);
    },
    [selectItem],
  );

  const getSelectionTarget = useCallback((): SelectionTarget | null => {
    const selectedSnapshot = getSelectionSnapshot();
    if (selectedSnapshot.size === 0) return null;
    const anchor = getAnchorPath();
    const anchorIndex = anchor ? selectionIndexMap.get(anchor) : undefined;
    let target: string | null = null;
    // Prefer the anchor if it is still in view; otherwise pick the earliest selection.
    if (anchor && anchorIndex != null && selectedSnapshot.has(anchor)) {
      target = anchor;
    } else {
      let bestIndex = Number.POSITIVE_INFINITY;
      for (const path of selectedSnapshot) {
        const index = selectionIndexMap.get(path);
        if (index != null && index < bestIndex) {
          bestIndex = index;
          target = path;
        }
      }
    }
    if (!target) return null;
    if (parentPath && target === parentPath) {
      return { path: target, isDir: true };
    }
    const entry = entryByPath.get(target);
    if (!entry) return null;
    return { path: entry.path, isDir: entry.isDir };
  }, [
    entryByPath,
    getAnchorPath,
    getSelectionSnapshot,
    parentPath,
    selectionIndexMap,
  ]);

  return {
    selected,
    selectItem,
    clearSelection,
    setSelection,
    selectionItems,
    entryByPath,
    getSelectionIndex,
    getSelectionTarget,
    handleSelectItem,
  };
};
