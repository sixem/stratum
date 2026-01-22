// Derives counts/flags from backend-filtered/sorted entries.
import { useMemo } from "react";
import type { FileEntry } from "@/types";

type UseFilteredEntriesOptions = {
  entries: FileEntry[];
  searchValue: string;
  totalCount: number;
};

export const useFilteredEntries = ({
  entries,
  searchValue,
  totalCount,
}: UseFilteredEntriesOptions) => {
  const trimmedQuery = searchValue.trim();
  const visibleCount = entries.length;
  const isFiltered = trimmedQuery.length > 0;
  const resolvedTotalCount = totalCount || entries.length;
  const sortedEntries = useMemo(() => entries, [entries]);
  const filteredEntries = sortedEntries;

  const countLabel = useMemo(() => {
    return isFiltered
      ? `${visibleCount} of ${resolvedTotalCount} items`
      : `${resolvedTotalCount} items`;
  }, [isFiltered, resolvedTotalCount, visibleCount]);

  return {
    filteredEntries,
    sortedEntries,
    countLabel,
    totalCount: resolvedTotalCount,
    visibleCount,
    isFiltered,
  };
};
