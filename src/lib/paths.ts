export function tabLabel(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return "<new tab>";
  const normalized = trimmed.replace(/[\\/]+$/, "");
  if (/^[a-zA-Z]:$/.test(normalized)) {
    return normalized.toUpperCase();
  }
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] || normalized;
}

// Returns the last segment of a path for display.
export function getPathName(path: string) {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

export function normalizePath(path: string) {
  const normalized = path.trim().replace(/\//g, "\\");
  return normalized.replace(/[\\]+$/, "").toLowerCase();
}

// Returns the parent directory for a path, or null when it cannot be resolved.
export function getParentPath(path: string) {
  const normalized = path.trim().replace(/\//g, "\\");
  if (!normalized) return null;
  const trimmed = normalized.replace(/[\\]+$/, "");
  if (!trimmed) return null;
  if (/^[a-zA-Z]:$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const lastSlash = trimmed.lastIndexOf("\\");
  if (lastSlash <= 0) {
    return null;
  }
  const parent = trimmed.slice(0, lastSlash);
  if (/^[a-zA-Z]:$/.test(parent)) {
    return parent.toUpperCase();
  }
  return parent;
}

export function activeDrive(path: string, drives: string[]) {
  const current = normalizePath(path);
  return (
    drives.find((drive) => current.startsWith(normalizePath(drive))) ?? null
  );
}
