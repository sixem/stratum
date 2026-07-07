// Result-list presentation for indexed search.
//
// This component only renders the current query state. Fetching, debounce, and
// keyboard movement live in hooks so the list stays predictable and reusable.
import type { RefObject } from "react";

import { EmptyState, PressButton, ScrollArea } from "@/components/primitives";
import type { IndexedPathMatch } from "@/types";
import {
  normalizeIndexedPathKey,
  type IndexedSelection,
} from "./indexedSearchModalTypes";

type IndexedSearchResultsListProps = {
  onOpenResult: (path: string) => void;
  onSelectResult: (result: IndexedPathMatch, index: number) => void;
  resultRefs: RefObject<Array<HTMLButtonElement | null>>;
  results: IndexedPathMatch[];
  resultsError: string | null;
  resultsViewportRef: RefObject<HTMLDivElement | null>;
  selection: IndexedSelection | null;
  shownResultCount: number;
  trimmedQuery: string;
};

export const IndexedSearchResultsList = ({
  onOpenResult,
  onSelectResult,
  resultRefs,
  results,
  resultsError,
  resultsViewportRef,
  selection,
  shownResultCount,
  trimmedQuery,
}: IndexedSearchResultsListProps) => {
  const resultsMetaLabel = `${shownResultCount} shown`;
  const showResultsEmptyState =
    resultsError || trimmedQuery.length === 0 || results.length === 0;
  const resultsEmptyTitle = resultsError
    ? "Search unavailable"
    : trimmedQuery.length === 0
      ? "Start an indexed search"
      : "No indexed matches yet";
  const resultsEmptySubtitle = resultsError
    ? resultsError
    : trimmedQuery.length === 0
      ? "Search indexed files and folders by name. Wildcards like * and ? are supported."
      : `Nothing matched "${trimmedQuery}" in the current index yet.`;

  return (
    <section className="indexed-search-results" aria-label="Indexed results">
      <div className="indexed-search-section-head">
        <div className="indexed-search-section-title">Results</div>
        <div className="indexed-search-section-meta">{resultsMetaLabel}</div>
      </div>

      <div className="indexed-search-section-body">
        {showResultsEmptyState ? (
          <div className="indexed-search-empty">
            <EmptyState title={resultsEmptyTitle} subtitle={resultsEmptySubtitle} />
          </div>
        ) : (
          <ScrollArea
            ref={resultsViewportRef}
            className="indexed-search-scroll"
            viewportClassName="indexed-search-scroll-viewport"
            contentClassName="indexed-search-scroll-content indexed-search-result-list"
            scrollbarVariant="overlay"
          >
            {results.map((result, index) => {
              const isSelected =
                selection?.kind === "result" &&
                normalizeIndexedPathKey(selection.path) ===
                  normalizeIndexedPathKey(result.path);

              return (
                <PressButton
                  key={result.path}
                  type="button"
                  ref={(element) => {
                    resultRefs.current[index] = element;
                  }}
                  className="indexed-search-result"
                  data-selected={isSelected}
                  pressOnPointerDown={false}
                  onClick={() => onSelectResult(result, index)}
                  onFocus={() => onSelectResult(result, index)}
                  onDoubleClick={() => {
                    onOpenResult(result.path);
                  }}
                >
                  <div className="indexed-search-result-head">
                    <span className="indexed-search-result-name">{result.name}</span>
                    <span className="indexed-search-result-kind">{result.kind}</span>
                  </div>
                  <div className="indexed-search-result-path">{result.path}</div>
                </PressButton>
              );
            })}
          </ScrollArea>
        )}
      </div>
    </section>
  );
};
