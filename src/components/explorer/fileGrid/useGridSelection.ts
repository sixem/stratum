// Selection and drag-out wiring for the file grid.
import type { RefObject } from "react";
import { useEntryDragOut, useSelectionDrag } from "@/hooks";
import type { DropTarget } from "@/lib";
import { VIEW_INSET } from "../fileView/constants";

const noop = () => {};

type UseGridSelectionOptions = {
  viewportRef: RefObject<HTMLDivElement | null>;
  selectedPaths: Set<string>;
  selectionItems: { path: string; selectable: boolean }[];
  columnCount: number;
  columnWidth: number;
  rowHeight: number;
  gridGap: number;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onClearSelection: () => void;
  onStartDragOut?: (paths: string[]) => void;
  onInternalDrop?: (paths: string[], target: DropTarget | null) => void;
  onInternalHover?: (target: DropTarget | null) => void;
  loading: boolean;
};

export const useGridSelection = ({
  viewportRef,
  selectedPaths,
  selectionItems,
  columnCount,
  columnWidth,
  rowHeight,
  gridGap,
  onSetSelection,
  onClearSelection,
  onStartDragOut,
  onInternalDrop,
  onInternalHover,
  loading,
}: UseGridSelectionOptions) => {
  const { selectionBox } = useSelectionDrag(viewportRef, {
    selected: selectedPaths,
    setSelection: onSetSelection,
    clearSelection: onClearSelection,
    itemSelector: "[data-selectable=\"true\"]",
    layout: {
      kind: "grid",
      items: selectionItems,
      columnCount,
      columnWidth,
      rowHeight,
      gap: gridGap,
      insetTop: VIEW_INSET,
    },
  });

  const dragEnabled = Boolean(onStartDragOut) && !loading;
  useEntryDragOut(viewportRef, {
    selected: selectedPaths,
    onSetSelection,
    onStartDrag: onStartDragOut ?? noop,
    onInternalDrop,
    onInternalHover,
    itemSelector: "[data-selectable=\"true\"]",
    enabled: dragEnabled,
  });

  return { selectionBox };
};
