// Path input and search bar for quick navigation.
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { ChevronUpIcon, FilterIcon, NavArrowIcon } from "./Icons";

type PathBarProps = {
  path: string;
  search: string;
  onPathChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
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
  onBack,
  onForward,
  onUp,
  onRefresh,
  canGoBack,
  canGoForward,
  canGoUp,
  loading,
  searchInputRef,
}: PathBarProps) {
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
    <form className="pathbar" onSubmit={handleSubmit}>
      <div className="path-controls">
        <button
          type="button"
          className="btn ghost"
          onClick={onBack}
          disabled={loading || !canGoBack}
          aria-disabled={loading || !canGoBack}
          aria-label="Back"
        >
          <NavArrowIcon className="btn-icon nav-arrow is-back" />
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onForward}
          disabled={loading || !canGoForward}
          aria-disabled={loading || !canGoForward}
          aria-label="Forward"
        >
          <NavArrowIcon className="btn-icon nav-arrow" />
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onUp}
          disabled={loading || !canGoUp}
          aria-disabled={loading || !canGoUp}
          aria-label="Up one level"
        >
          <ChevronUpIcon className="btn-icon" />
        </button>
      </div>
      <input
        value={path}
        onChange={(event) => onPathChange(event.currentTarget.value)}
        onKeyDown={handlePathKeyDown}
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
