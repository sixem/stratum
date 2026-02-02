// Sortable list header for the file list view.
import { useCallback } from "react";
import { PressButton } from "../PressButton";
import { nextSortState } from "@/lib";
import type { SortKey, SortState } from "@/types";

type ListHeaderProps = {
  sortState: SortState;
  onSortChange: (next: SortState) => void;
};

export const ListHeader = ({ sortState, onSortChange }: ListHeaderProps) => {
  // Header buttons reuse the global sort state.
  const handleSortClick = useCallback(
    (key: SortKey) => {
      onSortChange(nextSortState(sortState, key));
    },
    [onSortChange, sortState],
  );

  return (
    <div className="list-header" role="row" data-selection-ignore="true">
      <PressButton
        type="button"
        className="list-header-button"
        data-sort-active={sortState.key === "name" ? "true" : "false"}
        data-sort-dir={sortState.dir}
        aria-sort={
          sortState.key === "name"
            ? sortState.dir === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        onClick={() => handleSortClick("name")}
      >
        Name
      </PressButton>
      <PressButton
        type="button"
        className="list-header-button is-right"
        data-sort-active={sortState.key === "size" ? "true" : "false"}
        data-sort-dir={sortState.dir}
        aria-sort={
          sortState.key === "size"
            ? sortState.dir === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        onClick={() => handleSortClick("size")}
      >
        Size
      </PressButton>
      <PressButton
        type="button"
        className="list-header-button is-right"
        data-sort-active={sortState.key === "modified" ? "true" : "false"}
        data-sort-dir={sortState.dir}
        aria-sort={
          sortState.key === "modified"
            ? sortState.dir === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        onClick={() => handleSortClick("modified")}
      >
        Modified
      </PressButton>
    </div>
  );
};
