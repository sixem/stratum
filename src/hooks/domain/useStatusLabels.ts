// Formats status bar labels from current counts and selection metadata.
import { useMemo } from "react";
import { formatBytes, formatCount, formatPercent } from "@/lib";
import type { DriveInfo, EntryMeta } from "@/types";

type UseStatusLabelsOptions = {
  isFiltered: boolean;
  visibleCount: number;
  totalCount: number;
  currentDriveInfo?: DriveInfo;
  selected: Set<string>;
  entryMeta: Map<string, EntryMeta>;
};

export const useStatusLabels = ({
  isFiltered,
  visibleCount,
  totalCount,
  currentDriveInfo,
  selected,
  entryMeta,
}: UseStatusLabelsOptions) => {
  const countLabel = useMemo(() => {
    const base = isFiltered
      ? `${formatCount(visibleCount)} of ${formatCount(totalCount)} items`
      : `${formatCount(totalCount)} items`;
    const free = currentDriveInfo?.free ?? null;
    const total = currentDriveInfo?.total ?? null;
    if (free == null) return base;
    const percent = total != null ? formatPercent(free, total) : null;
    const freeLabel = `${formatBytes(free)} free${percent ? `, ${percent}` : ""}`;
    return `${base} (${freeLabel})`;
  }, [currentDriveInfo, isFiltered, totalCount, visibleCount]);

  const selectionLabel = useMemo(() => {
    const selectedCount = selected.size;
    if (!selectedCount) return "";
    let totalBytes = 0;
    let hasUnknown = false;

    selected.forEach((path) => {
      const meta = entryMeta.get(path);
      if (!meta || meta.size == null) {
        hasUnknown = true;
        return;
      }
      totalBytes += meta.size;
    });

    const countText = `${formatCount(selectedCount)} selected`;
    if (hasUnknown) {
      return countText;
    }
    const bytesLabel = totalBytes.toLocaleString();
    const suffix = totalBytes === 1 ? "byte" : "bytes";
    return `${countText}: ${formatBytes(totalBytes)} (${bytesLabel} ${suffix})`;
  }, [entryMeta, selected]);

  return { countLabel, selectionLabel };
};
