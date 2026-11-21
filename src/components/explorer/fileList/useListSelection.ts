// Selection and drag-out wiring for list rows.
import type { RefObject } from "react";
import { useEntryDragOut, useSelectionDrag } from "@/hooks";
import { VIEW_INSET } from "../fileView/constants";

type UseListSelectionOptions = {
  listRef: RefObject<HTMLDivElement | null>;
  selectedPaths: Set<string>;
  selectionItems: { path: string; selectable: boolean }[];
  itemHeight: number;
  rowHeight: number;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onClearSelection: () => void;
  onStartDragOut?: (paths: string[], folderPath?: string) => void;
  loading: boolean;
};

export const useListSelection = ({
  listRef,
  selectedPaths,
  selectionItems,
  itemHeight,
  rowHeight,
  onSetSelection,
  onClearSelection,
  onStartDragOut,
  loading,
}: UseListSelectionOptions) => {
  const { selectionBox } = useSelectionDrag(listRef, {
    selected: selectedPaths,
    setSelection: onSetSelection,
    clearSelection: onClearSelection,
    itemSelector: "[data-selectable=\"true\"]",
    layout: {
      kind: "list",
      items: selectionItems,
      itemHeight,
      rowHeight,
      insetTop: VIEW_INSET,
    },
  });

  const dragHandlers = useEntryDragOut({
    selected: selectedPaths,
    onSetSelection,
    onStartDrag: onStartDragOut,
    loading,
  });

  return { selectionBox, dragHandlers };
};
