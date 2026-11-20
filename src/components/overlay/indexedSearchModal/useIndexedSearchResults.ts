// Debounce typing and keep one running search plus the latest queued refresh.
import { useCallback, useEffect, useRef, useState } from "react";

import { queryIndexedPaths } from "@/api";
import { toMessage } from "@/lib";
import type { IndexedPathMatch } from "@/types";
import {
  INDEXED_SEARCH_QUERY_DEBOUNCE_MS,
  INDEXED_SEARCH_RESULT_LIMIT,
} from "./indexedSearchModalConfig";

type UseIndexedSearchResultsParams = {
  catalogPending: boolean;
  catalogRevision: number | undefined;
  open: boolean;
  query: string;
};

type SearchRequest = { query: string; catalogRevision: number | undefined };
type SearchResult = SearchRequest & {
  matches: IndexedPathMatch[];
  error: string | null;
};

const EMPTY_RESULTS: IndexedPathMatch[] = [];

export const useIndexedSearchResults = ({
  catalogPending,
  catalogRevision,
  open,
  query,
}: UseIndexedSearchResultsParams) => {
  const resultsViewportRef = useRef<HTMLDivElement | null>(null);
  const latestRequestRef = useRef<SearchRequest | null>(null);
  const runningRef = useRef(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [lastResult, setLastResult] = useState<SearchResult | null>(null);
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!open || !trimmedQuery) {
      setDebouncedQuery("");
      setLastResult(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
    }, INDEXED_SEARCH_QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [open, trimmedQuery]);

  const runLatest = useCallback(async () => {
    if (runningRef.current) return;

    runningRef.current = true;
    try {
      while (latestRequestRef.current) {
        const request = latestRequestRef.current;
        let result: SearchResult;

        try {
          const matches = await queryIndexedPaths({
            query: request.query,
            limit: INDEXED_SEARCH_RESULT_LIMIT,
          });
          result = { ...request, matches, error: null };
        } catch (error) {
          result = {
            ...request,
            matches: EMPTY_RESULTS,
            error: toMessage(error, "Search is currently unavailable."),
          };
        }

        // A new query or catalog revision can replace the pending request
        // during the invoke. Only publish the last requested result.
        if (latestRequestRef.current === request) {
          latestRequestRef.current = null;
          setLastResult(result);
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (catalogPending || !open || !debouncedQuery || trimmedQuery !== debouncedQuery) return;

    const request = { query: debouncedQuery, catalogRevision };
    latestRequestRef.current = request;
    void runLatest();

    return () => {
      if (latestRequestRef.current === request) latestRequestRef.current = null;
    };
  }, [catalogPending, catalogRevision, debouncedQuery, open, runLatest, trimmedQuery]);

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
    resultsViewportRef,
    searching: trimmedQuery.length > 0 && (
      currentResult == null || (
        results.length === 0 && currentResult.error == null &&
        currentResult.catalogRevision !== catalogRevision
      )
    ),
  };
};
