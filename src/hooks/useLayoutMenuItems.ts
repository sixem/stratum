// Builds context menu items for the empty layout area (paste + sort).
import { useMemo } from "react";
import { useClipboardStore } from "@/modules";
import type { ContextMenuItem, SortState } from "@/types";
import { useSortMenuItems } from "./useSortMenuItems";

type UseLayoutMenuItemsOptions = {
  sortState: SortState;
  onSortChange: (next: SortState) => void;
  onPaste: (paths: string[]) => void;
};

export const useLayoutMenuItems = ({
  sortState,
  onSortChange,
  onPaste,
}: UseLayoutMenuItemsOptions) => {
  const clipboard = useClipboardStore((state) => state.clipboard);
  const sortItems = useSortMenuItems(sortState, onSortChange);

  return useMemo<ContextMenuItem[]>(() => {
    const canPaste = Boolean(clipboard && clipboard.paths.length > 0);

    return [
      {
        id: "layout-paste",
        label: "Paste",
        onSelect: () => {
          if (!clipboard || clipboard.paths.length === 0) return;
          onPaste(clipboard.paths);
        },
        disabled: !canPaste,
      },
      { kind: "divider", id: "layout-divider-sort" },
      ...sortItems,
    ];
  }, [clipboard, onPaste, sortItems]);
};
