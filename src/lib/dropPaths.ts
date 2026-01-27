// Shared helpers for normalizing drag/drop paths.
// Centralizing this logic keeps drop handling consistent across UI surfaces.
import { getParentPath, getPathName, normalizePath } from "./paths";

export type DropCandidate = {
  path: string;
  name: string;
  isSameDirectory: boolean;
};

// Normalize drag/drop paths that may include URL or extended-length prefixes.
export const sanitizeDropPath = (path: string) => {
  let trimmed = path.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("file://")) {
    trimmed = trimmed.replace(/^file:\/*/i, "");
    if (trimmed.toLowerCase().startsWith("localhost/")) {
      trimmed = trimmed.slice("localhost/".length);
    }
    trimmed = trimmed.replace(/^\/+/, "");
    try {
      trimmed = decodeURIComponent(trimmed);
    } catch {
      // Ignore decode errors; we'll compare the raw value.
    }
  }
  if (trimmed.startsWith("\\\\?\\")) {
    trimmed = trimmed.slice(4);
  } else if (trimmed.startsWith("//?/")) {
    trimmed = trimmed.slice(4);
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("unc\\")) {
    trimmed = `\\\\${trimmed.slice(4)}`;
  } else if (lower.startsWith("unc/")) {
    trimmed = `\\\\${trimmed.slice(4)}`;
  }
  return trimmed;
};

export const normalizeDropPath = (path: string) => {
  const cleaned = sanitizeDropPath(path);
  if (!cleaned) return "";
  return normalizePath(cleaned);
};

const getNormalizedParentKey = (normalizedPath: string) => {
  if (!normalizedPath) return "";
  const parent = getParentPath(normalizedPath);
  if (!parent) return "";
  return normalizePath(parent);
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
  const normalized = normalizePath(cleaned);
  if (!normalized) return null;
  const parentKey = getNormalizedParentKey(normalized);
  const isSameDirectory =
    normalized === destinationKey ||
    (parentKey !== "" && parentKey === destinationKey);
  return {
    path: cleaned,
    name: getPathName(cleaned),
    isSameDirectory,
  };
};
