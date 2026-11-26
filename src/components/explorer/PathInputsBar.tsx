// Dedicated bar for the path and search inputs.
import { useId } from "react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { FileFilterHint } from "@/components/primitives/FileFilterHint";
import { PressButton } from "@/components/primitives/PressButton";
import { FilterIcon, LibraryIcon, RefreshIcon } from "@/components/icons";
import type { useFilterResultSelection } from "@/hooks/ui/selection/useFilterResultSelection";
import { useIndexedSearchUiStore } from "@/modules";

type PathInputsBarProps = {
  path: string;
  search: string;
  indexedSearchEnabled: boolean;
  filterSelectionKeys?: ReturnType<typeof useFilterResultSelection>;
  onPathChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSubmit: () => void;
  onRefresh: () => void;
  loading: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
};

export const PathInputsBar = ({
  path,
  search,
  indexedSearchEnabled,
  filterSelectionKeys,
  onPathChange,
  onSearchChange,
  onSubmit,
  onRefresh,
  loading,
  searchInputRef,
}: PathInputsBarProps) => {
  const openIndexedSearch = useIndexedSearchUiStore((state) => state.openModal);
  const filterHintId = useId();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  const handlePathKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter in the path input should navigate immediately.
    if (event.key !== "Enter") return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="path-inputbar" onSubmit={handleSubmit}>
      <input
        className="path-input"
        value={path}
        onChange={(event) => onPathChange(event.currentTarget.value)}
        onKeyDown={handlePathKeyDown}
        placeholder="Enter a path"
        aria-label="Current path"
        spellCheck={false}
        autoComplete="off"
      />
      <PressButton
        type="button"
        className="inputbar-refresh"
        onClick={onRefresh}
        disabled={loading}
        aria-label="Refresh"
      >
        <RefreshIcon className="btn-icon" />
      </PressButton>
      <div className="search-field">
        <FileFilterHint id={filterHintId}><FilterIcon className="search-icon" /></FileFilterHint>
        <input
          className="search-input"
          ref={searchInputRef}
          value={search}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          {...filterSelectionKeys}
          placeholder="Search"
          aria-label="Search current folder"
          aria-describedby={filterHintId}
          spellCheck={false}
          autoComplete="off"
        />
        {indexedSearchEnabled ? (
          <PressButton
            type="button"
            className="inputbar-indexed-search"
            pressOnPointerDown={false}
            onClick={openIndexedSearch}
            aria-label="Open indexed search"
          >
            <LibraryIcon className="inputbar-indexed-icon" />
          </PressButton>
        ) : null}
      </div>
    </form>
  );
};
