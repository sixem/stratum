// Result-list presentation for indexed search.
//
// This component only renders the current query state. Fetching, debounce, and
// keyboard movement live in hooks so the list stays predictable and reusable.
import type { KeyboardEvent, RefObject } from "react";

import loader from "@/assets/icons/loaders/ring.svg";
import { BinocularsIcon, ErrorIcon, FallbackFileIcon, FolderIcon } from "@/components/icons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton, ScrollArea } from "@/components/primitives";
import type { IndexedPathMatch } from "@/types";
import { INDEXED_SEARCH_RESULT_LIMIT } from "./indexedSearchModalConfig";

type IndexedSearchResultsListProps = {
  catalogPending: boolean;
  onOpenResult: (path: string) => void;
  onResultKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onSelectResult: (result: IndexedPathMatch) => void;
  resultRefs: RefObject<Array<HTMLButtonElement | null>>;
  results: IndexedPathMatch[];
  resultsError: string | null;
  resultsViewportRef: RefObject<HTMLDivElement | null>;
  searching: boolean;
  selectedPath: string | undefined;
  trimmedQuery: string;
};

export const IndexedSearchResultsList = ({
  catalogPending,
  onOpenResult,
  onResultKeyDown,
  onSelectResult,
  resultRefs,
  results,
  resultsError,
  resultsViewportRef,
  searching,
  selectedPath,
  trimmedQuery,
}: IndexedSearchResultsListProps) => {
  const hasQuery = trimmedQuery.length > 0;
  const resultCount = results.length;
  const loading = !resultsError && (catalogPending || searching);
  const resultsMetaLabel = resultCount === INDEXED_SEARCH_RESULT_LIMIT
    ? `${resultCount} shown · display limit`
    : `${resultCount} ${resultCount === 1 ? "match" : "matches"}`;
  const emptyTitle = resultsError
    ? "Search unavailable"
    : catalogPending
      ? "Preparing the index…"
      : searching
        ? "Searching the index…"
        : hasQuery
          ? "No matches"
          : "Find a file or folder";
  const emptyHint = resultsError ?? (hasQuery
    ? "Try a shorter name or a wildcard pattern."
    : "Enter part of a name or use a wildcard like *.pdf.");

  return (
    <section className="indexed-search-results" aria-label="Indexed results">
      <div className="indexed-search-section-head">
        <h3 className="indexed-search-section-title">Results</h3>
        <span className="indexed-search-section-meta tnum" role="status">
          {hasQuery ? (resultCount === 0 && (loading || resultsError) ? emptyTitle : resultsMetaLabel) : null}
        </span>
      </div>

      {resultCount === 0 ? (
        <div className="indexed-search-empty">
          <div className="indexed-search-empty-symbol">
            {loading ? <img src={loader} alt="" /> : (resultsError ? <ErrorIcon /> : <BinocularsIcon />)}
          </div>
          <p className="indexed-search-empty-title">{emptyTitle}</p>
          {loading ? null : <p className="indexed-search-empty-hint">{emptyHint}</p>}
        </div>
      ) : (
        <ScrollArea
          ref={resultsViewportRef}
          className="indexed-search-scroll"
          contentClassName="indexed-search-result-list"
          scrollbarVariant="overlay"
        >
          {results.map((result, index) => {
            const isSelected = selectedPath === result.path;
            const isDirectory = result.kind === "directory";

            return (
              <TooltipWrapper key={result.path} text={result.path}>
                <PressButton
                  type="button"
                  ref={(element) => {
                    resultRefs.current[index] = element;
                  }}
                  className="indexed-search-result"
                  aria-pressed={isSelected}
                  tabIndex={isSelected || (selectedPath == null && index === 0) ? 0 : -1}
                  pressOnPointerDown={false}
                  onClick={() => onSelectResult(result)}
                  onFocus={() => onSelectResult(result)}
                  onKeyDown={onResultKeyDown}
                  onDoubleClick={() => onOpenResult(result.path)}
                >
                  <span className="indexed-search-result-icon" data-kind={result.kind}>
                    {isDirectory ? <FolderIcon /> : <FallbackFileIcon />}
                  </span>
                  <span className="indexed-search-result-copy">
                    <span className="indexed-search-result-name">{result.name}</span>
                    <span className="indexed-search-result-path">
                      {result.parentPath || result.path}
                    </span>
                  </span>
                  <span className="indexed-search-result-kind">{isDirectory ? "Folder" : "File"}</span>
                </PressButton>
              </TooltipWrapper>
            );
          })}
        </ScrollArea>
      )}
    </section>
  );
};
