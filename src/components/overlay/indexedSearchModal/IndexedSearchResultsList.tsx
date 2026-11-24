// Result-list presentation for indexed search.
//
// This component only renders the current query state. Fetching, debounce, and
// keyboard movement live in hooks so the list stays predictable and reusable.
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";

import loader from "@/assets/icons/loaders/ring.svg";
import { ErrorIcon, FileTypeIcon, LibraryIcon } from "@/components/icons";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton, ScrollArea } from "@/components/primitives";
import { MetadataLabel } from "@/components/primitives/MetadataLabel";
import { useVirtualRange } from "@/hooks/perf/scroll/useVirtualRange";
import { getExtension, getFileKind } from "@/lib/fileKind";
import { formatBytes, formatCount } from "@/lib/format";
import type { IndexedPathMatch } from "@/types";
import {
  INDEXED_SEARCH_RESULT_HEIGHT, INDEXED_SEARCH_RESULT_INSET, INDEXED_SEARCH_RESULT_STRIDE,
} from "./indexedSearchModalConfig";
import { useIndexedSearchResultSizes } from "./useIndexedSearchResultSizes";
import type { IndexedCopyModifiers } from "./indexedCopySelection";

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
  onSelectResultForCopy: (result: IndexedPathMatch, modifiers: IndexedCopyModifiers) => void;
  registerResultRow: (path: string, row: HTMLButtonElement | null) => void;
  results: IndexedPathMatch[];
  resultsError: string | null;
  pageError: string | null;
  refreshError: string | null;
  refreshing: boolean;
  resultsUpdated: boolean;
  refreshResults: () => void;
  scrollRestore?: { top: number };
  resultsViewportRef: RefObject<HTMLDivElement | null>;
  searching: boolean;
  selectedResultIndex: number;
  copyPaths: ReadonlySet<string> | null;
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
  onSelectResultForCopy,
  registerResultRow,
  results,
  resultsError,
  pageError,
  refreshError,
  refreshing,
  resultsUpdated,
  refreshResults,
  scrollRestore,
  resultsViewportRef,
  searching,
  selectedResultIndex,
  copyPaths,
  trimmedQuery,
  visible,
}: IndexedSearchResultsListProps) => {
  const hasQuery = trimmedQuery.length > 0;
  const resultCount = results.length;
  const loading = !resultsError && (catalogPending || searching);
  const resultsMetaLabel = `${formatCount(resultCount)}${hasMore ? "+" : ""} ${resultCount === 1 && !hasMore ? "match" : "matches"}`;
  const appliedScroll = useRef<typeof scrollRestore>(undefined);
  const restoreScroll = useCallback(() => {
    const viewport = resultsViewportRef.current;
    if (!visible || !viewport?.clientHeight || !scrollRestore || appliedScroll.current === scrollRestore) return;
    viewport.scrollTop = scrollRestore.top;
    appliedScroll.current = scrollRestore;
  }, [resultsViewportRef, scrollRestore, visible]);
  const { startIndex, endIndex } = useVirtualRange(
    resultsViewportRef, resultCount, INDEXED_SEARCH_RESULT_STRIDE, OVERSCAN,
    INDEXED_SEARCH_RESULT_INSET, INDEXED_SEARCH_RESULT_INSET, { beforeLayoutMeasure: restoreScroll },
  );
  const visibleResults = useMemo(() => results.slice(startIndex, endIndex), [endIndex, results, startIndex]);
  const sizes = useIndexedSearchResultSizes(visible, visibleResults);
  const tabbableIndex = Math.max(0, selectedResultIndex);
  const renderedIndexes = visibleResults.map((_, index) => startIndex + index);
  // Keep one row mounted as the tab stop and preserve keyboard focus during scroll.
  if (tabbableIndex < startIndex) renderedIndexes.unshift(tabbableIndex);
  if (tabbableIndex >= endIndex && tabbableIndex < resultCount) renderedIndexes.push(tabbableIndex);

  useEffect(() => {
    if (!visible || catalogPending || !hasMore || resultsUpdated || loadingMore || pageError || endIndex === 0) return;
    const viewport = resultsViewportRef.current;
    if (!viewport || endIndex < results.length - NEXT_PAGE_THRESHOLD) return;
    // A fresh result set can commit before React restores the virtual range.
    // Check the viewport itself before fetching beyond the refreshed pages.
    const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (remaining <= (OVERSCAN + NEXT_PAGE_THRESHOLD + 1) * INDEXED_SEARCH_RESULT_STRIDE) loadMore();
  }, [catalogPending, endIndex, hasMore, loadMore, loadingMore, pageError, results, resultsUpdated, resultsViewportRef, visible]);
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
    ? "Try a shorter name or fewer filters."
    : "Search by name, wildcard, size or type.");

  return (
    <section className="indexed-search-results" aria-label="Indexed results">
      <div className="indexed-search-section-head">
        <h3 className="indexed-search-section-title">Results</h3>
        <div className="indexed-search-results-status">
          <span className="indexed-search-section-meta tnum" role="status">
            {hasQuery ? (resultCount === 0 && (loading || resultsError) ? emptyTitle : resultsMetaLabel) : null}
            {copyPaths && copyPaths.size > 1 ? ` · ${formatCount(copyPaths.size)} selected` : null}
          </span>
          {loadingMore ? <img src={loader} alt="Loading more results" /> : null}
          {resultsUpdated ? (
            <TooltipWrapper text={refreshError ?? "Refresh results"}>
              <PressButton
                className="btn ghost indexed-search-results-refresh"
                type="button"
                aria-description={refreshError ?? "Refresh results"}
                aria-disabled={refreshing || catalogPending}
                pressOnPointerDown={false}
                onClick={refreshResults}
              >
                {refreshing ? "Refreshing…" : refreshError ? "Retry refresh" : "Results updated"}
              </PressButton>
            </TooltipWrapper>
          ) : pageError ? (
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
              const isActive = selectedResultIndex === index;
              const isSelected = copyPaths?.has(result.path) ?? isActive;
              const isDirectory = result.kind === "directory";
              const size = result.sizeBytes ?? sizes.get(result.path);

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
                  data-active={isActive || undefined}
                  aria-pressed={isSelected}
                  aria-haspopup="menu"
                  tabIndex={tabbableIndex === index ? 0 : -1}
                  pressOnPointerDown={false}
                  onClick={(event) => {
                    onSelectResultForCopy(result, { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
                    event.currentTarget.focus({ preventScroll: true });
                  }}
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
                    if (event.button === 0 && (event.ctrlKey || event.metaKey || event.shiftKey)) {
                      // Keep the previous focused row as the range anchor until click updates it.
                      event.preventDefault();
                    }
                    if (event.button !== 1 || isDirectory) return;
                    event.currentTarget.focus({ preventScroll: true });
                    if (!onPreviewPress(result.path)) return;
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onDoubleClick={(event) => {
                    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) onOpenResult(result);
                  }}
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
                  {isDirectory ? (
                    <span className="indexed-search-result-detail">Folder</span>
                  ) : (
                    <MetadataLabel
                      className="indexed-search-result-detail tnum"
                      value={size == null ? null : formatBytes(size)}
                      placeholder="—"
                    />
                  )}
                </PressButton>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </section>
  );
};
