// Debounce typing and keep one running search plus the latest queued refresh.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { queryIndexedPathPage } from "@/api";
import { toMessage } from "@/lib";
import type { IndexedPathMatch } from "@/types";
import {
  INDEXED_SEARCH_QUERY_DEBOUNCE_MS,
  INDEXED_SEARCH_PAGE_SIZE,
} from "./indexedSearchModalConfig";
import {
  canFinishIndexedSearchRefresh,
  captureIndexedSearchAnchor,
  restoreIndexedSearchAnchor,
} from "./indexedSearchRefresh";
import type { IndexedSearchRefreshAnchor, IndexedSearchScrollRestore } from "./indexedSearchRefresh";
import { indexedResultLookup } from "./indexedResultLookup";

type UseIndexedSearchResultsParams = {
  catalogPending: boolean;
  catalogRevision: number | undefined;
  open: boolean;
  query: string;
};

type SearchScope = { query: string; catalogRevision: number | undefined };
type SearchResult = SearchScope & {
  matches: IndexedPathMatch[];
  indexes: Map<string, number>;
  nextCursor: string | null;
  paged: boolean;
  error: string | null;
  pageError: string | null;
  refreshError?: string;
  scrollRestore?: IndexedSearchScrollRestore;
};
type SearchRequest = SearchScope & (
  | { kind: "head" }
  | { kind: "next"; previous: SearchResult }
  | { kind: "refresh"; previous: SearchResult; selectedIndex: number; anchor: IndexedSearchRefreshAnchor | null }
);

const EMPTY_RESULTS: IndexedPathMatch[] = [];
const EMPTY_INDEXES = new Map<string, number>();

export const useIndexedSearchResults = ({
  catalogPending,
  catalogRevision,
  open,
  query,
}: UseIndexedSearchResultsParams) => {
  const resultsViewportRef = useRef<HTMLDivElement | null>(null);
  const latestRequestRef = useRef<SearchRequest | null>(null);
  const lastResultRef = useRef<SearchResult | null>(null);
  const runningRef = useRef(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [lastResult, setLastResult] = useState<SearchResult | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const trimmedQuery = query.trim();

  useEffect(() => {
    lastResultRef.current = null;
    setLastResult(null);
    setLoadingMore(false);
    setRefreshing(false);
    if (!open || !trimmedQuery) {
      setDebouncedQuery("");
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
    }, INDEXED_SEARCH_QUERY_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeoutId);
      latestRequestRef.current = null;
    };
  }, [open, trimmedQuery]);

  const runLatest = useCallback(async () => {
    if (runningRef.current) return;

    runningRef.current = true;
    try {
      while (latestRequestRef.current) {
        const request = latestRequestRef.current;
        const { query, catalogRevision } = request;
        const previousPage = request.kind === "next" ? request.previous : null;
        let result: SearchResult;

        try {
          let cursor = previousPage?.nextCursor ?? null;
          const added: IndexedPathMatch[] = [];
          const addedIndexes = new Map<string, number>();
          const visitedCursors = new Set<string>();
          let anchor = request.kind === "refresh" ? request.anchor : null;
          do {
            if (cursor) visitedCursors.add(cursor);
            const page = await queryIndexedPathPage({ query, limit: INDEXED_SEARCH_PAGE_SIZE, cursor });
            if (latestRequestRef.current !== request) break;
            for (const match of page.matches) {
              if (previousPage?.indexes.has(match.path) || addedIndexes.has(match.path)) continue;
              addedIndexes.set(match.path, added.length);
              added.push(match);
            }
            cursor = page.nextCursor && !visitedCursors.has(page.nextCursor) ? page.nextCursor : null;
            if (request.kind === "refresh") {
              // The user can continue scrolling the old list during a refresh.
              const viewport = resultsViewportRef.current;
              if (viewport?.clientHeight && (
                !anchor || viewport.scrollTop !== anchor.scrollTop || viewport.clientHeight !== anchor.viewportHeight
              )) {
                anchor = captureIndexedSearchAnchor(request.previous.matches, viewport, request.selectedIndex);
              }
              if (canFinishIndexedSearchRefresh(addedIndexes, anchor)) break;
            } else if (added.length) break;
            // A cursor can traverse a page whose paths are already in the list.
          } while (cursor !== null);

          if (latestRequestRef.current !== request) continue;
          // Stage additions until the request succeeds. Cancelled pages and
          // retries must never reserve a path in the published result set.
          const indexes = previousPage?.indexes ?? addedIndexes;
          if (previousPage) {
            for (const [path, offset] of addedIndexes) indexes.set(path, previousPage.matches.length + offset);
          }
          result = {
            query, catalogRevision, indexes, matches: previousPage ? previousPage.matches.concat(added) : added,
            nextCursor: cursor, paged: request.kind !== "head",
            error: null, pageError: null,
            scrollRestore: request.kind === "refresh"
              ? restoreIndexedSearchAnchor(added, addedIndexes, anchor)
              : previousPage?.scrollRestore,
          };
        } catch (error) {
          if (request.kind === "refresh") {
            result = { ...request.previous, refreshError: toMessage(error, "Couldn't refresh results.") };
          } else if (previousPage) {
            result = { ...previousPage, pageError: toMessage(error, "Couldn't load more results.") };
          } else {
            result = {
              query, catalogRevision, matches: EMPTY_RESULTS, indexes: EMPTY_INDEXES, nextCursor: null, paged: false,
              error: toMessage(error, "Search is currently unavailable."), pageError: null,
            };
          }
        }

        // A new query or catalog revision can replace the pending request
        // during the invoke. Only publish the last requested result.
        if (latestRequestRef.current === request) {
          latestRequestRef.current = null;
          lastResultRef.current = result;
          setLastResult(result);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  useLayoutEffect(() => {
    const pending = latestRequestRef.current;
    if (pending && pending.kind !== "head" && (catalogPending || pending.catalogRevision !== catalogRevision)) {
      // A known catalog change invalidates the cursor before the next page can be appended.
      latestRequestRef.current = null;
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [catalogPending, catalogRevision]);

  useEffect(() => {
    if (catalogPending || !open || !debouncedQuery || trimmedQuery !== debouncedQuery) return;
    // Keep the established scroll range while the user is browsing later pages.
    if (lastResultRef.current?.paged) return;

    const request: SearchRequest = { kind: "head", query: debouncedQuery, catalogRevision };
    latestRequestRef.current = request;
    void runLatest();

    return () => {
      if (latestRequestRef.current === request) latestRequestRef.current = null;
    };
  }, [catalogPending, catalogRevision, debouncedQuery, open, runLatest, trimmedQuery]);

  const loadMore = useCallback(() => {
    const current = lastResultRef.current;
    if (!open || catalogPending || !current?.nextCursor || current.query !== trimmedQuery
      || current.catalogRevision !== catalogRevision || latestRequestRef.current) return;

    // Protect the current viewport even if a revision arrives during the first page request.
    const previous = current.paged ? current : { ...current, paged: true };
    lastResultRef.current = previous;
    if (previous !== current) setLastResult(previous);
    setLoadingMore(true);
    latestRequestRef.current = { kind: "next", query: previous.query, catalogRevision, previous };
    void runLatest();
  }, [catalogPending, catalogRevision, open, runLatest, trimmedQuery]);

  const refreshResults = useCallback((selectedIndex: number) => {
    const previous = lastResultRef.current;
    if (!open || catalogPending || !previous?.paged || previous.query !== trimmedQuery
      || previous.catalogRevision === catalogRevision || latestRequestRef.current?.kind === "refresh") return;
    // Preview can hide the viewport before the first refreshed page arrives.
    const viewport = resultsViewportRef.current;
    const anchor = viewport?.clientHeight ? captureIndexedSearchAnchor(previous.matches, viewport, selectedIndex) : null;
    setLoadingMore(false);
    setRefreshing(true);
    latestRequestRef.current = { kind: "refresh", query: previous.query, catalogRevision, previous, selectedIndex, anchor };
    void runLatest();
  }, [catalogPending, catalogRevision, open, runLatest, trimmedQuery]);

  useEffect(() => {
    if (!open) return;
    resultsViewportRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [debouncedQuery, open]);

  const currentResult = lastResult?.query === trimmedQuery ? lastResult : null;
  const results = currentResult?.matches ?? EMPTY_RESULTS;
  const indexes = currentResult?.indexes ?? EMPTY_INDEXES;
  const resultIndexes = useMemo(() => indexedResultLookup(indexes, results.length), [indexes, results.length]);

  return {
    trimmedQuery,
    results,
    resultIndexes,
    resultsError: currentResult?.error ?? null,
    pageError: currentResult?.pageError ?? null,
    refreshError: currentResult?.refreshError ?? null,
    resultsUpdated: Boolean(currentResult?.paged && currentResult.catalogRevision !== catalogRevision),
    refreshing,
    refreshResults,
    scrollRestore: currentResult?.scrollRestore,
    hasMore: Boolean(currentResult?.nextCursor),
    loadingMore,
    loadMore,
    resultsViewportRef,
    searching: trimmedQuery.length > 0 && (
      currentResult == null || (
        !currentResult.paged && results.length === 0 && currentResult.error == null &&
        currentResult.catalogRevision !== catalogRevision
      )
    ),
  };
};
