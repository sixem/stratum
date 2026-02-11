// Selection and drag-out wiring for list rows.
import type { RefObject } from "react";
import { useEntryDragOut, useSelectionDrag } from "@/hooks";
import type { DropTarget } from "@/lib";
import { COMPACT_VIEW_INSET } from "../fileView/constants";

const noop = () => {};

type UseListSelectionOptions = {
  listRef: RefObject<HTMLDivElement | null>;
  selectedPaths: Set<string>;
  selectionItems: { path: string; selectable: boolean }[];
  itemHeight: number;
  rowHeight: number;
  compactMode: boolean;
  onSetSelection: (paths: string[], anchor?: string) => void;
  onClearSelection: () => void;
  onStartDragOut?: (paths: string[]) => void;
  onInternalDrop?: (paths: string[], target: DropTarget | null) => void;
  onInternalHover?: (target: DropTarget | null) => void;
  loading: boolean;
};

export const useListSelection = ({
  listRef,
  selectedPaths,
  selectionItems,
  itemHeight,
  rowHeight,
  compactMode,
  onSetSelection,
  onClearSelection,
  onStartDragOut,
  onInternalDrop,
  onInternalHover,
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
      insetTop: compactMode ? COMPACT_VIEW_INSET : 0,
    },
  });

  const dragEnabled = Boolean(onStartDragOut) && !loading;
  useEntryDragOut(listRef, {
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
