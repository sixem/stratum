// Query lifecycle for indexed-search results.
//
// The hook keeps typing responsive with a short debounce, refreshes active
// searches while the backend is still changing, and resets transient result
// state whenever the modal closes.
import { useEffect, useRef, useState } from "react";

import { queryIndexedPaths } from "@/api";
import type { IndexedPathMatch } from "@/types";
import {
  INDEXED_SEARCH_QUERY_DEBOUNCE_MS,
  INDEXED_SEARCH_RESULT_LIMIT,
  INDEXED_SEARCH_RESULTS_REFRESH_MS,
} from "./indexedSearchModalConfig";

type UseIndexedSearchResultsParams = {
  open: boolean;
  query: string;
  shouldPollSnapshot: boolean;
};

export const useIndexedSearchResults = ({
  open,
  query,
  shouldPollSnapshot,
}: UseIndexedSearchResultsParams) => {
  const resultsViewportRef = useRef<HTMLDivElement | null>(null);
  const [resultsRefreshVersion, setResultsRefreshVersion] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<IndexedPathMatch[]>([]);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [shownResultCount, setShownResultCount] = useState(0);

  const shouldPollResults =
    open && debouncedQuery.trim().length > 0 && shouldPollSnapshot;

  useEffect(() => {
    if (!open) return;
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, INDEXED_SEARCH_QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [open, query]);

  useEffect(() => {
    if (open) return;

    setDebouncedQuery("");
    setResults([]);
    setResultsError(null);
    setShownResultCount(0);
  }, [open]);

  useEffect(() => {
    if (!shouldPollResults) return;
    const intervalId = window.setInterval(() => {
      setResultsRefreshVersion((value) => value + 1);
    }, INDEXED_SEARCH_RESULTS_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [shouldPollResults]);

  useEffect(() => {
    if (!open) return;
    const trimmedQuery = debouncedQuery.trim();
    if (!trimmedQuery) {
      setResults([]);
      setResultsError(null);
      return;
    }

    let active = true;
    setResultsError(null);

    void queryIndexedPaths({ query: trimmedQuery, limit: INDEXED_SEARCH_RESULT_LIMIT })
      .then((nextResults) => {
        if (!active) return;
        setResults(nextResults);
      })
      .catch(() => {
        if (!active) return;
        setResults([]);
        setResultsError("Search is currently unavailable.");
      });

    return () => {
      active = false;
    };
  }, [debouncedQuery, open, resultsRefreshVersion]);

  useEffect(() => {
    setShownResultCount(results.length);
  }, [results]);

  useEffect(() => {
    if (!open) return;
    resultsViewportRef.current?.scrollTo({
      top: 0,
      behavior: "auto",
    });
  }, [open, results]);

  return {
    debouncedQuery,
    results,
    resultsError,
    resultsViewportRef,
    shownResultCount,
  };
};
