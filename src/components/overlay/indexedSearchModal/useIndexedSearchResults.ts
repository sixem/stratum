// Debounce typing and keep one running search plus the latest queued refresh.
import { useCallback, useEffect, useRef, useState } from "react";

import { queryIndexedPathPage } from "@/api";
import { toMessage } from "@/lib";
import type { IndexedPathMatch } from "@/types";
import {
  INDEXED_SEARCH_QUERY_DEBOUNCE_MS,
  INDEXED_SEARCH_PAGE_SIZE,
} from "./indexedSearchModalConfig";

type UseIndexedSearchResultsParams = {
  catalogPending: boolean;
  catalogRevision: number | undefined;
  open: boolean;
  query: string;
};

type SearchScope = { query: string; catalogRevision: number | undefined };
type SearchResult = SearchScope & {
  matches: IndexedPathMatch[];
  nextCursor: string | null;
  paged: boolean;
  error: string | null;
  pageError: string | null;
};
type SearchRequest = SearchScope & { previous?: SearchResult };

const EMPTY_RESULTS: IndexedPathMatch[] = [];

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
  const trimmedQuery = query.trim();

  useEffect(() => {
    lastResultRef.current = null;
    setLastResult(null);
    setLoadingMore(false);
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
        const { previous, query, catalogRevision } = request;
        let result: SearchResult;

        try {
          let cursor = previous?.nextCursor ?? null;
          let matches: IndexedPathMatch[];
          const existingPaths = previous && new Set(previous.matches.map(({ path }) => path));
          // Drive changes can invalidate hits or move already shown paths beyond the cursor.
          // Keep advancing through pages that add nothing to the current results.
          do {
            const page = await queryIndexedPathPage({ query, limit: INDEXED_SEARCH_PAGE_SIZE, cursor });
            matches = existingPaths
              ? page.matches.filter(({ path }) => !existingPaths.has(path))
              : page.matches;
            cursor = page.nextCursor === cursor ? null : page.nextCursor;
          } while (matches.length === 0 && cursor !== null && latestRequestRef.current === request);

          if (latestRequestRef.current !== request) continue;
          if (previous) matches = previous.matches.concat(matches);
          result = {
            query, catalogRevision, matches, nextCursor: cursor, paged: Boolean(previous),
            error: null, pageError: null,
          };
        } catch (error) {
          result = previous
            ? { ...previous, pageError: toMessage(error, "Couldn't load more results.") }
            : {
              query, catalogRevision, matches: EMPTY_RESULTS, nextCursor: null, paged: false,
              error: toMessage(error, "Search is currently unavailable."), pageError: null,
            };
        }

        // A new query or catalog revision can replace the pending request
        // during the invoke. Only publish the last requested result.
        if (latestRequestRef.current === request) {
          latestRequestRef.current = null;
          lastResultRef.current = result;
          setLastResult(result);
          setLoadingMore(false);
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (catalogPending || !open || !debouncedQuery || trimmedQuery !== debouncedQuery) return;
    // Keep the established scroll range while the user is browsing later pages.
    if (lastResultRef.current?.paged || latestRequestRef.current?.previous) return;

    const request = { query: debouncedQuery, catalogRevision };
    latestRequestRef.current = request;
    void runLatest();

    return () => {
      if (latestRequestRef.current === request) latestRequestRef.current = null;
    };
  }, [catalogPending, catalogRevision, debouncedQuery, open, runLatest, trimmedQuery]);

  const loadMore = useCallback(() => {
    const previous = lastResultRef.current;
    if (!open || catalogPending || !previous?.nextCursor || previous.query !== trimmedQuery
      || latestRequestRef.current) return;

    setLoadingMore(true);
    latestRequestRef.current = { query: previous.query, catalogRevision: previous.catalogRevision, previous };
    void runLatest();
  }, [catalogPending, open, runLatest, trimmedQuery]);

  useEffect(() => {
    if (!open) return;
    resultsViewportRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [debouncedQuery, open]);

  const currentResult = lastResult?.query === trimmedQuery ? lastResult : null;
  const results = currentResult?.matches ?? EMPTY_RESULTS;

  return {
    trimmedQuery,
    results,
    resultsError: currentResult?.error ?? null,
    pageError: currentResult?.pageError ?? null,
    hasMore: Boolean(currentResult?.nextCursor),
    loadingMore,
    loadMore,
    resultsViewportRef,
    searching: trimmedQuery.length > 0 && (
      currentResult == null || (
        results.length === 0 && currentResult.error == null &&
        currentResult.catalogRevision !== catalogRevision
      )
    ),
  };
};
