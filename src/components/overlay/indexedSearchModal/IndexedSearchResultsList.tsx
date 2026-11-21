// Result-list presentation for indexed search.
//
// This component only renders the current query state. Fetching, debounce, and
// keyboard movement live in hooks so the list stays predictable and reusable.
import type { KeyboardEvent, RefObject } from "react";

import loader from "@/assets/icons/loaders/ring.svg";
import { ErrorIcon, FileTypeIcon, LibraryIcon } from "@/components/icons";
import { PressButton, ScrollArea } from "@/components/primitives";
import { getExtension, getFileKind } from "@/lib/fileKind";
import type { IndexedPathMatch } from "@/types";
import { INDEXED_SEARCH_RESULT_LIMIT } from "./indexedSearchModalConfig";

type IndexedSearchResultsListProps = {
  catalogPending: boolean;
  onOpenResult: (result: IndexedPathMatch) => void;
  onOpenContextMenu: (result: IndexedPathMatch, point: { x: number; y: number }, native: boolean) => void;
  onPreviewPress: (path: string) => boolean;
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
  onOpenContextMenu,
  onPreviewPress,
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
            {loading ? <img src={loader} alt="" /> : (resultsError ? <ErrorIcon /> : <LibraryIcon />)}
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
              <PressButton
                key={result.path}
                type="button"
                ref={(element) => {
                  resultRefs.current[index] = element;
                }}
                className="indexed-search-result"
                data-path={result.path}
                aria-pressed={isSelected}
                aria-haspopup="menu"
                tabIndex={isSelected || (selectedPath == null && index === 0) ? 0 : -1}
                pressOnPointerDown={false}
                onClick={() => onSelectResult(result)}
                onFocus={() => onSelectResult(result)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.focus({ preventScroll: true });
                  onOpenContextMenu(result, { x: event.clientX, y: event.clientY }, event.shiftKey);
                }}
                onKeyDown={(event) => {
                  const native = event.shiftKey && event.key === "F10";
                  if (event.key !== "ContextMenu" && !native) {
                    onResultKeyDown(event);
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.repeat) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  onOpenContextMenu(result, { x: bounds.left, y: bounds.bottom }, native);
                }}
                onMouseDown={(event) => {
                  if (event.button !== 1 || isDirectory) return;
                  event.currentTarget.focus({ preventScroll: true });
                  if (!onPreviewPress(result.path)) return;
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDoubleClick={() => onOpenResult(result)}
              >
                <span className="indexed-search-result-icon" data-kind={result.kind}>
                  <FileTypeIcon
                    isDir={isDirectory}
                    fileKind={isDirectory ? "generic" : getFileKind(result.name)}
                    extension={isDirectory ? null : getExtension(result.name)}
                  />
                </span>
                <span className="indexed-search-result-copy">
                  <span className="indexed-search-result-name">{result.name}</span>
                  <span className="indexed-search-result-path">
                    {result.parentPath || result.path}
                  </span>
                </span>
                <span className="indexed-search-result-kind">{isDirectory ? "Folder" : "File"}</span>
              </PressButton>
            );
          })}
        </ScrollArea>
      )}
    </section>
  );
};
