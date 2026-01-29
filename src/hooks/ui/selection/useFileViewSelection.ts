// Handles view selection state for list and grid views.
import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { FileViewModel } from "../view/useFileViewModel";
import { useSelection } from "./useSelection";

type SelectionTarget = {
  path: string;
  isDir: boolean;
};

type UseFileViewSelectionOptions = {
  viewModel: FileViewModel;
  resetKey: string;
};

export const useFileViewSelection = ({
  viewModel,
  resetKey,
}: UseFileViewSelectionOptions) => {
  // Use the shared view model so selection stays aligned with rendered order.
  const selectionItems = viewModel.itemPaths;
  const selectionIndexMap = viewModel.indexMap;
  const entryByPath = viewModel.entryByPath;
  const parentPath = viewModel.parentPath;

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
    indexMap: selectionIndexMap,
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
