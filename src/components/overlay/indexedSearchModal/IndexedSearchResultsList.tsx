// Result-list presentation for indexed search.
//
// This component only renders the current query state. Fetching, debounce, and
// keyboard movement live in hooks so the list stays predictable and reusable.
import { useEffect, useMemo } from "react";
import type { KeyboardEvent, RefObject } from "react";

import loader from "@/assets/icons/loaders/ring.svg";
import { ErrorIcon, FileTypeIcon, LibraryIcon } from "@/components/icons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton, ScrollArea } from "@/components/primitives";
import { useVirtualRange } from "@/hooks/perf/scroll/useVirtualRange";
import { getExtension, getFileKind } from "@/lib/fileKind";
import { formatBytes, formatCount } from "@/lib/format";
import type { IndexedPathMatch } from "@/types";
import {
  INDEXED_SEARCH_RESULT_HEIGHT, INDEXED_SEARCH_RESULT_INSET, INDEXED_SEARCH_RESULT_STRIDE,
} from "./indexedSearchModalConfig";
import { useIndexedSearchResultSizes } from "./useIndexedSearchResultSizes";

const OVERSCAN = 5;
const NEXT_PAGE_THRESHOLD = 4;

type IndexedSearchResultsListProps = {
  catalogPending: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  onOpenResult: (result: IndexedPathMatch) => void;
  onOpenContextMenu: (result: IndexedPathMatch, point: { x: number; y: number }, native: boolean) => void;
  onPreviewPress: (path: string) => boolean;
  onResultKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onSelectResult: (result: IndexedPathMatch) => void;
  registerResultRow: (path: string, row: HTMLButtonElement | null) => void;
  results: IndexedPathMatch[];
  resultsError: string | null;
  pageError: string | null;
  resultsViewportRef: RefObject<HTMLDivElement | null>;
  searching: boolean;
  selectedResultIndex: number;
  trimmedQuery: string;
  visible: boolean;
};

export const IndexedSearchResultsList = ({
  catalogPending,
  hasMore,
  loadingMore,
  loadMore,
  onOpenResult,
  onOpenContextMenu,
  onPreviewPress,
  onResultKeyDown,
  onSelectResult,
  registerResultRow,
  results,
  resultsError,
  pageError,
  resultsViewportRef,
  searching,
  selectedResultIndex,
  trimmedQuery,
  visible,
}: IndexedSearchResultsListProps) => {
  const hasQuery = trimmedQuery.length > 0;
  const resultCount = results.length;
  const loading = !resultsError && (catalogPending || searching);
  const resultsMetaLabel = `${formatCount(resultCount)}${hasMore ? "+" : ""} ${resultCount === 1 && !hasMore ? "match" : "matches"}`;
  const { startIndex, endIndex } = useVirtualRange(
    resultsViewportRef, resultCount, INDEXED_SEARCH_RESULT_STRIDE, OVERSCAN,
    INDEXED_SEARCH_RESULT_INSET, INDEXED_SEARCH_RESULT_INSET,
  );
  const visibleResults = useMemo(() => results.slice(startIndex, endIndex), [endIndex, results, startIndex]);
  const sizes = useIndexedSearchResultSizes(visible, visibleResults);
  const tabbableIndex = Math.max(0, selectedResultIndex);
  const renderedIndexes = visibleResults.map((_, index) => startIndex + index);
  // Keep one row mounted as the tab stop and preserve keyboard focus during scroll.
  if (tabbableIndex < startIndex) renderedIndexes.unshift(tabbableIndex);
  if (tabbableIndex >= endIndex && tabbableIndex < resultCount) renderedIndexes.push(tabbableIndex);

  useEffect(() => {
    if (!visible || catalogPending || !hasMore || loadingMore || pageError || endIndex === 0) return;
    if (endIndex >= results.length - NEXT_PAGE_THRESHOLD) loadMore();
  }, [catalogPending, endIndex, hasMore, loadMore, loadingMore, pageError, results, visible]);
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
        <div className="indexed-search-results-status">
          <span className="indexed-search-section-meta tnum" role="status">
            {hasQuery ? (resultCount === 0 && (loading || resultsError) ? emptyTitle : resultsMetaLabel) : null}
          </span>
          {loadingMore ? <img src={loader} alt="Loading more results" /> : null}
          {pageError ? (
            <TooltipWrapper text={pageError}>
              <PressButton
                className="btn ghost"
                type="button"
                aria-label="Retry loading more results"
                aria-description={pageError}
                disabled={loadingMore}
                onClick={loadMore}
              >
                Retry
              </PressButton>
            </TooltipWrapper>
          ) : null}
        </div>
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
          scrollbarVariant="overlay"
        >
          <div className="indexed-search-result-list" style={{
            height: resultCount * INDEXED_SEARCH_RESULT_STRIDE + 2 * INDEXED_SEARCH_RESULT_INSET,
          }}>
            {renderedIndexes.map((index) => {
              const result = results[index];
              const isSelected = selectedResultIndex === index;
              const isDirectory = result.kind === "directory";
              const size = sizes.get(result.path);

              return (
                <PressButton
                  key={result.path}
                  type="button"
                  ref={(element) => { registerResultRow(result.path, element); }}
                  className="indexed-search-result"
                  style={{
                    insetBlockStart: INDEXED_SEARCH_RESULT_INSET + index * INDEXED_SEARCH_RESULT_STRIDE,
                    height: INDEXED_SEARCH_RESULT_HEIGHT,
                  }}
                  data-path={result.path}
                  aria-pressed={isSelected}
                  aria-haspopup="menu"
                  tabIndex={tabbableIndex === index ? 0 : -1}
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
                  <span className="indexed-search-result-detail tnum">
                    {isDirectory ? "Folder" : size == null ? "—" : formatBytes(size)}
                  </span>
                </PressButton>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </section>
  );
};
