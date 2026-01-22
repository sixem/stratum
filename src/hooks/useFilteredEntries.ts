// Filters and sorts entries based on search and sort state.
import { useMemo } from "react";
import type { EntryMeta, FileEntry, SortState } from "@/types";
import { sortEntries } from "@/lib";

type UseFilteredEntriesOptions = {
  entries: FileEntry[];
  entryMeta: Map<string, EntryMeta>;
  searchValue: string;
  sortState: SortState;
  metaReady?: boolean;
};

export const useFilteredEntries = ({
  entries,
  entryMeta,
  searchValue,
  sortState,
  metaReady = true,
}: UseFilteredEntriesOptions) => {
  const trimmedQuery = searchValue.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedQuery) return entries;
    return entries.filter((entry) =>
      entry.name.toLowerCase().includes(normalizedQuery),
    );
  }, [entries, normalizedQuery]);

  const totalCount = entries.length;
  const visibleCount = filteredEntries.length;
  const isFiltered = trimmedQuery.length > 0;

  const needsMeta = sortState.key !== "name";
  const metaDependency = needsMeta && metaReady ? entryMeta : 0;
  // Only sort once metadata is ready for size/modified sorts.
  const sortedEntries = useMemo(() => {
    if (needsMeta && !metaReady) return filteredEntries;
    return sortEntries(filteredEntries, entryMeta, sortState);
  }, [filteredEntries, metaDependency, metaReady, needsMeta, sortState]);

  const countLabel = useMemo(() => {
    return isFiltered ? `${visibleCount} of ${totalCount} items` : `${totalCount} items`;
  }, [isFiltered, totalCount, visibleCount]);

  return {
    filteredEntries,
    sortedEntries,
    countLabel,
    totalCount,
    visibleCount,
    isFiltered,
  };
};
