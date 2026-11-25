// Normalize saved picker preferences while retaining the distinction between all and no drives.
import { folderPathKey } from "../lib/paths.ts";

export type QuickMovePreferences = {
  favorites: readonly string[];
  driveRoots: readonly string[] | null;
  maxDepth: number | null;
};

export const DEFAULT_QUICK_MOVE_PREFERENCES: QuickMovePreferences = {
  favorites: [],
  driveRoots: null,
  maxDepth: null,
};

// A folder remap may point to a subfolder on the replacement drive.
export const getQuickMoveDriveRoot = (path: string): string | null => {
  const drive = /^(?:\\\\\?\\)?([a-z]):(?:\\|$)/i.exec(path.trim().replace(/\//g, "\\"));
  return drive ? drive[1].toUpperCase() + ":\\" : null;
};

export const coerceQuickMovePreferences = (stored: unknown): QuickMovePreferences => {
  if (!stored || typeof stored !== "object") return DEFAULT_QUICK_MOVE_PREFERENCES;
  const { favorites, driveRoots, maxDepth } = stored as Partial<QuickMovePreferences>;
  const paths = new Map<string, string>();
  if (Array.isArray(favorites)) {
    for (const value of favorites) {
      if (typeof value !== "string" || value.includes("\0")) continue;
      const path = value.trim();
      const key = folderPathKey(path);
      if (key && !paths.has(key)) paths.set(key, path);
    }
  }

  const drives = Array.isArray(driveRoots)
    ? [...new Set(driveRoots.flatMap((value) => {
      const root = typeof value === "string" ? getQuickMoveDriveRoot(value) : null;
      return root ? [root] : [];
    }))]
    : null;
  return {
    favorites: [...paths.values()],
    driveRoots: drives,
    maxDepth: typeof maxDepth === "number" && Number.isSafeInteger(maxDepth) && maxDepth >= 0 ? maxDepth : null,
  };
};

export const isDefaultQuickMovePreferences = ({ favorites, driveRoots, maxDepth }: QuickMovePreferences) =>
  !favorites.length && driveRoots === null && maxDepth === null;
