// Tooltip text builders for entries and drives.
import type { DriveInfo, EntryMeta, FileEntry } from "@/types";
import { TOOLTIP_CACHE_LIMIT } from "@/constants";
import { formatBytes, formatDate, formatPercent } from "./format";
import { formatIndexedDriveState } from "./indexedSearch";
const entryTooltipCache = new Map<string, string>();

const getFileTypeLabel = (name: string) => {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return "File";
  }
  const ext = name.slice(lastDot + 1).toUpperCase();
  return `${ext} file`;
};

const formatSizeDetail = (size: number | null | undefined) => {
  if (size == null) return "...";
  const bytesLabel = size.toLocaleString();
  const suffix = size === 1 ? "byte" : "bytes";
  return `${formatBytes(size)} (${bytesLabel} ${suffix})`;
};

const buildEntryTooltipCore = (entry: FileEntry, meta?: EntryMeta) => {
  if (entry.isDir) {
    return entry.path;
  }

  const modifiedLabel = meta?.modified == null ? "..." : formatDate(meta.modified);

  return [
    `Name: ${entry.name}`,
    `Type: ${getFileTypeLabel(entry.name)}`,
    `Size: ${formatSizeDetail(meta?.size ?? null)}`,
    `Modified: ${modifiedLabel}`,
    `Len (Full Path): ${entry.name.length} (${entry.path.length} characters)`,
    `Full Path: ${entry.path}`,
  ].join("\n");
};

const trimEntryTooltipCache = () => {
  while (entryTooltipCache.size > TOOLTIP_CACHE_LIMIT) {
    const oldest = entryTooltipCache.keys().next().value;
    if (!oldest) break;
    entryTooltipCache.delete(oldest);
  }
};

// Cache entry tooltips so list/grid renders avoid repeated formatting work.
export const buildEntryTooltip = (entry: FileEntry, meta?: EntryMeta) => {
  if (entry.isDir) {
    return entry.path;
  }
  const keyParts = [
    entry.path,
    entry.name,
    meta?.size ?? "null",
    meta?.modified ?? "null",
  ];
  const cacheKey = keyParts.join("|");
  const cached = entryTooltipCache.get(cacheKey);
  if (cached) return cached;
  const tooltip = buildEntryTooltipCore(entry, meta);
  entryTooltipCache.set(cacheKey, tooltip);
  trimEntryTooltipCache();
  return tooltip;
};

export const buildDriveTooltip = (label: string, info?: DriveInfo, indexLabel?: string) => {
  const heading = label.trim();

  const details = [heading];
  if (info?.total != null && info.free != null) {
    const used = Math.max(0, info.total - info.free);
    const usedPercent = formatPercent(used, info.total);
    const freePercent = formatPercent(info.free, info.total);
    details.push(`Used: ${formatBytes(used)}${usedPercent ? ` (${usedPercent})` : ""}`);
    details.push(`Free: ${formatBytes(info.free)}${freePercent ? ` (${freePercent})` : ""}`);
    details.push(`Total: ${formatBytes(info.total)}`);
  }

  const indexedState = info?.indexStatus?.state;
  if (indexLabel) {
    details.push(indexLabel);
  } else if (indexedState) {
    details.push(`Indexed search: ${formatIndexedDriveState(indexedState)}`);
  }

  return details.join("\n");
};
