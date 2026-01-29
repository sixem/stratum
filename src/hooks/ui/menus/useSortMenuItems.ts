// Builds sort menu items from the current sort state.
import { useMemo } from "react";
import { nextSortState } from "@/lib";
import type { ContextMenuItem, SortKey, SortState } from "@/types";

export const useSortMenuItems = (sortState: SortState, onSortChange: (next: SortState) => void) =>
  useMemo<ContextMenuItem[]>(() => {
    const buildItem = (key: SortKey, label: string): ContextMenuItem => ({
      id: `sort-${key}`,
      label,
      active: sortState.key === key,
      hint: sortState.key === key ? sortState.dir.toUpperCase() : undefined,
      onSelect: () => onSortChange(nextSortState(sortState, key)),
    });

    return [
      buildItem("name", "Sort by name"),
      buildItem("size", "Sort by size"),
      buildItem("modified", "Sort by modified"),
    ];
  }, [onSortChange, sortState]);
