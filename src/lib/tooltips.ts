// Tooltip text builders for entries and drives.
import type { DriveInfo, EntryMeta, FileEntry } from "@/types";
import { formatBytes, formatDate, formatPercent } from "./format";

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

export const buildEntryTooltip = (entry: FileEntry, meta?: EntryMeta) => {
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

export const buildDriveTooltip = (label: string, info?: DriveInfo) => {
  if (!info || info.free == null) return label;
  const percent = info.total ? formatPercent(info.free, info.total) : null;
  const prefix = label.endsWith(":") ? label : `${label}:`;
  return `${prefix} ${formatBytes(info.free)} free${percent ? ` (${percent})` : ""}`;
};
