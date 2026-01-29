// Dedicated bar for the path and search inputs.
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { FilterIcon, RefreshIcon } from "./Icons";

type PathInputsBarProps = {
  path: string;
  search: string;
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
  onPathChange,
  onSearchChange,
  onSubmit,
  onRefresh,
  loading,
  searchInputRef,
}: PathInputsBarProps) => {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    onSubmit();
  };

  const handlePathKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter in the path input should navigate immediately.
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (loading) return;
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
      <button
        type="button"
        className="inputbar-refresh"
        onClick={onRefresh}
        disabled={loading}
        aria-label="Refresh"
      >
        <RefreshIcon className="btn-icon" />
      </button>
      <div className="search-field">
        <FilterIcon className="search-icon" />
        <input
          className="search-input"
          ref={searchInputRef}
          value={search}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
            }
          }}
          placeholder="Search"
          aria-label="Search current folder"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </form>
  );
};
