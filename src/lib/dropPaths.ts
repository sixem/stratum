// Shared helpers for normalizing drag/drop paths.
// Centralizing this logic keeps drop handling consistent across UI surfaces.
import { getParentPath, getPathName, normalizePath } from "./paths.ts";

export type DropCandidate = {
  path: string;
  name: string;
  isSameDirectory: boolean;
};

// Normalize drag/drop paths that may include URL or extended-length prefixes.
export const sanitizeDropPath = (path: string) => {
  if (!path.trim()) return "";
  if (!/^file:\/\//i.test(path)) return path;
  try {
    const url = new URL(path);
    const name = decodeURIComponent(url.pathname).replace(/\//g, "\\");
    if (url.hostname) return "\\\\" + url.hostname + name;
    return name.replace(/^\\([a-z]:\\)/i, "$1");
  } catch {
    return "";
  }
};

export const normalizeDropPath = (path: string) => {
  const cleaned = sanitizeDropPath(path);
  if (!cleaned) return "";
  // Strip equivalent prefixes only for comparisons. A volume GUID path has
  // no usable drive-relative spelling, and long paths need their original prefix.
  return normalizePath(cleaned)
    .replace(/^\\\\\?\\unc\\/i, "\\\\")
    .replace(/^\\\\\?\\([a-z]:)/i, "$1");
};

export const joinPath = (base: string, name: string) => {
  const trimmed = base.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return name;
  return `${trimmed}\\${name}`;
};

// Normalize drop paths once so we can skip no-op drops locally.
export const buildDropCandidate = (
  path: string,
  destinationKey: string,
): DropCandidate | null => {
  const cleaned = sanitizeDropPath(path);
  if (!cleaned) return null;
  const normalized = normalizeDropPath(cleaned);
  if (!normalized) return null;
  const parentKey = normalizeDropPath(getParentPath(cleaned) ?? "");
  const isSameDirectory =
    normalized === destinationKey ||
    (parentKey !== "" && parentKey === destinationKey);
  return {
    path: cleaned,
    name: getPathName(cleaned),
    isSameDirectory,
  };
};
