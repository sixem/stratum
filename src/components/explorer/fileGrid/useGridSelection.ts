// Selection and drag-out wiring for the file grid.
import type { RefObject } from "react";
import { useEntryDragOut, useSelectionDrag } from "@/hooks";
import { VIEW_INSET } from "../fileView/constants";

type UseGridSelectionOptions = {
  viewportRef: RefObject<HTMLDivElement | null>;
  selectedPaths: Set<string>;
  selectionItems: { path: string; selectable: boolean }[];
  canSelectPath: (path: string) => boolean;
  columnCount: number;
  columnWidth: number;
  columnGap: number;
  rowHeight: number;
  rowGap: number;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onClearSelection: () => void;
  onStartDragOut?: (paths: string[], folderPath?: string) => void;
  loading: boolean;
};

export const useGridSelection = ({
  viewportRef,
  selectedPaths,
  selectionItems,
  canSelectPath,
  columnCount,
  columnWidth,
  columnGap,
  rowHeight,
  rowGap,
  onSetSelection,
  onClearSelection,
  onStartDragOut,
  loading,
}: UseGridSelectionOptions) => {
  const { selectionBox } = useSelectionDrag(viewportRef, {
    selected: selectedPaths,
    setSelection: onSetSelection,
    clearSelection: onClearSelection,
    itemSelector: "[data-selectable=\"true\"]",
    canSelectPath,
    layout: {
      kind: "grid",
      items: selectionItems,
      columnCount,
      columnWidth,
      rowHeight,
      columnGap,
      rowGap,
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
