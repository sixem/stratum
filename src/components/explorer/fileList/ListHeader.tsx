// Sortable list header for the file list view.
import { PressButton } from "@/components/primitives/PressButton";
import { nextSortState } from "@/lib";
import type { SortKey, SortState } from "@/types";

type ListHeaderProps = {
  sortState: SortState;
  onSortChange: (next: SortState) => void;
  showSize: boolean;
  showModified: boolean;
};

export const ListHeader = ({ sortState, onSortChange, showSize, showModified }: ListHeaderProps) => {
  const renderColumn = (key: SortKey, label: string) => {
    const active = sortState.key === key;
    return (
      <PressButton
        type="button"
        className={key === "name" ? "list-header-button" : "list-header-button is-right"}
        data-sort-active={active}
        data-sort-dir={sortState.dir}
        aria-sort={active ? (sortState.dir === "asc" ? "ascending" : "descending") : "none"}
        onClick={() => onSortChange(nextSortState(sortState, key))}
      >
        {label}
      </PressButton>
    );
  };

  return (
    <div className="list-header" role="row" data-list-header data-selection-ignore="true">
      {renderColumn("name", "Name")}
      {showSize && renderColumn("size", "Size")}
      {showModified && renderColumn("modified", "Modified")}
    </div>
  );
};
