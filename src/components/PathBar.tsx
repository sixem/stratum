// Path input and search bar for quick navigation.
import type { FormEvent, RefObject } from "react";
import { ChevronUpIcon, FilterIcon } from "./Icons";

type PathBarProps = {
  path: string;
  search: string;
  onPathChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSubmit: () => void;
  onUp: () => void;
  onRefresh: () => void;
  canGoUp: boolean;
  loading: boolean;
  searchInputRef?: RefObject<HTMLInputElement | null>;
};

export function PathBar({
  path,
  search,
  onPathChange,
  onSearchChange,
  onSubmit,
  onUp,
  onRefresh,
  canGoUp,
  loading,
  searchInputRef,
}: PathBarProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    onSubmit();
  };

  return (
    <form className="pathbar" onSubmit={handleSubmit}>
      <button
        type="button"
        className="btn ghost"
        onClick={onUp}
        disabled={!canGoUp}
        aria-disabled={loading || !canGoUp}
        aria-label="Up one level"
      >
        <ChevronUpIcon className="btn-icon" />
      </button>
      <input
        value={path}
        onChange={(event) => onPathChange(event.currentTarget.value)}
        placeholder="Enter a path"
        aria-label="Current path"
        spellCheck={false}
        autoComplete="off"
      />
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
      <button type="button" className="btn ghost" onClick={onRefresh} disabled={loading}>
        Refresh
      </button>
    </form>
  );
}
