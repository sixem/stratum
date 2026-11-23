// Search the folder catalog in pages. A response stays tied to the exact
// criteria that requested it, including while the next search is debouncing.
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toMessage } from "@/lib/fsUtils";
import type { IndexedPathMatch, IndexedPathPage } from "@/types";

const PAGE_SIZE = 40;
const SEARCH_DELAY_MS = 120;
const EMPTY_MATCHES: IndexedPathMatch[] = [];

export type QuickMoveSearch = {
  search: string;
  scopeRoots: string[];
  maxDepth: number | null;
};

type SearchResult = IndexedPathPage & {
  scope: QuickMoveSearch;
  paged: boolean;
  error: string | null;
};

type PageRequest = {
  scope: QuickMoveSearch;
  cursor?: string;
  previous?: SearchResult;
};

const queryPage = ({ scope, cursor }: PageRequest) => invoke<IndexedPathPage>(
  "query_indexed_folder_page",
  { query: { ...scope, limit: PAGE_SIZE, cursor } },
);

export const useQuickMoveFolderSearch = (scope: QuickMoveSearch, enabled: boolean, revision: number | undefined) => {
  const desired = enabled && scope.search && scope.scopeRoots.length > 0 ? scope : null;
  const [result, setResult] = useState<SearchResult | null>(null);
  const resultRef = useRef<SearchResult | null>(null);
  const queued = useRef<PageRequest | null>(null);
  const running = useRef(false);
  const [moreRequest, setMoreRequest] = useState<PageRequest | null>(null);
  const [refresh, setRefresh] = useState(0);
  const visibleResult = desired && result?.scope === desired ? result : null;

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queued.current) {
        const request = queued.current;
        let next: SearchResult;
        try {
          const page = await queryPage(request);
          const previous = request.previous;
          const seen = new Set(previous?.matches.map(({ path }) => path));
          const matches = previous?.matches.slice() ?? [];
          for (const item of page.matches) {
            if (seen.has(item.path)) continue;
            seen.add(item.path);
            matches.push(item);
          }
          next = {
            scope: request.scope,
            matches,
            nextCursor: page.nextCursor === request.cursor ? null : page.nextCursor,
            paged: Boolean(previous),
            error: null,
          };
        } catch (error) {
          next = {
            scope: request.scope,
            matches: request.previous?.matches ?? EMPTY_MATCHES,
            nextCursor: request.previous?.nextCursor ?? null,
            paged: Boolean(request.previous),
            error: toMessage(error, "Couldn't search indexed folders."),
          };
        }
        if (queued.current !== request) continue;
        queued.current = null;
        resultRef.current = next;
        setResult(next);
        setMoreRequest(null);
      }
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    if (!desired) return;
    // Preserve the current scroll range once the user starts browsing later pages.
    if (resultRef.current?.scope === desired && resultRef.current.paged) return;
    if (queued.current?.scope === desired && queued.current.previous) return;
    const request = { scope: desired };
    const timer = window.setTimeout(() => {
      if (queued.current?.scope === desired && queued.current.previous) return;
      queued.current = request;
      void run();
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (queued.current === request) queued.current = null;
    };
  }, [desired, revision, refresh, run]);

  useEffect(() => () => {
    queued.current = null;
  }, [desired]);

  const loadMore = useCallback(() => {
    const previous = resultRef.current;
    if (!desired || previous?.scope !== desired || !previous.nextCursor || queued.current?.previous) return;
    const request = { scope: desired, previous, cursor: previous.nextCursor };
    queued.current = request;
    setMoreRequest(request);
    void run();
  }, [desired, run]);

  return {
    matches: visibleResult?.matches ?? EMPTY_MATCHES,
    loading: Boolean(desired && !visibleResult),
    loadingMore: Boolean(desired && moreRequest?.scope === desired && visibleResult),
    hasMore: Boolean(visibleResult?.nextCursor),
    error: visibleResult?.error ?? null,
    loadMore,
    retry: () => {
      if (visibleResult?.paged) loadMore();
      else setRefresh((value) => value + 1);
    },
  };
};
