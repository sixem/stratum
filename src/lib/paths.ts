export const tabLabel = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed) return "<new tab>";
  const normalized = trimmed.replace(/[\\/]+$/, "");
  if (/^[a-zA-Z]:$/.test(normalized)) {
    return normalized.toUpperCase();
  }
  const parts = normalized.split(/[/\\]/);
  return parts[parts.length - 1] || normalized;
};

// Returns the last segment of a path for display.
export const getPathName = (path: string) => {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
};

export const normalizePath = (path: string) => {
  const normalized = path.trim().replace(/\//g, "\\");
  return normalized.replace(/[\\]+$/, "").toLowerCase();
};

// Directory listing identities preserve NTFS case-sensitive folder names.
export const folderPathKey = (path: string) => {
  const normalized = path.trim().replace(/\//g, "\\")
    .replace(/^(?:\\\\\?\\)?[a-z]:/i, (drive) => drive.toUpperCase());
  const key = normalized.replace(/\\+$/, "");
  // A drive-relative path ("C:") and the drive's root ("C:\\") can list different folders.
  if (/^(?:\\\\\?\\)?[a-z]:$/i.test(key) && normalized.length > key.length) return key + "\\";
  return key || (normalized ? "\\" : "");
};

// Returns the parent directory for a path, or null when it cannot be resolved.
export const getParentPath = (path: string) => {
  const normalized = path.trim().replace(/\//g, "\\");
  const trimmed = normalized.replace(/[\\]+$/, "");
  if (!trimmed) return null;
  const lastSlash = trimmed.lastIndexOf("\\");
  // Windows resolves "C:" against the drive's working directory. Undo needs "C:\".
  const drive = /^(?:\\\\\?\\)?[a-z]:/i.exec(trimmed)?.[0];
  if (drive) {
    if (normalized[drive.length] !== "\\") return null;
    if (lastSlash <= drive.length) return drive.toUpperCase() + "\\";
  }
  // A UNC share is itself a filesystem root, including in extended-length paths.
  if (/^(?:\\\\\?\\UNC\\|\\\\(?![?.]\\))[^\\]+\\[^\\]+$/i.test(trimmed)) {
    return trimmed;
  }
  return lastSlash > 0 ? trimmed.slice(0, lastSlash) : null;
};

export const activeDrive = (path: string, drives: string[]) => {
  const current = normalizePath(path);
  return (
    drives.find((drive) => current.startsWith(normalizePath(drive))) ?? null
  );
};
