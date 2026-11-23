// Saved folders share the index filters and take precedence over duplicate matches.
import { folderPathKey, getPathName } from "@/lib/paths";
import { getQuickMoveDriveRoot } from "@/modules/quickMovePreferences";
import type { IndexedPathMatch } from "@/types";
import type { QuickMoveSearch } from "./useQuickMoveFolderSearch";

export type QuickMoveSection = "Favourites" | "Recent" | "Matches";

export type QuickMoveDestination = {
  path: string;
  name: string;
  key: string;
  section: QuickMoveSection;
  favorite: boolean;
  disabled: boolean;
};

const withoutVerbatimPrefix = (path: string) => path.replace(/^\\\\\?\\/, "");

type DestinationOptions = {
  favoritePaths: readonly string[];
  recentPaths: readonly string[];
  matches: readonly IndexedPathMatch[];
  scope: QuickMoveSearch;
  isDestinationDisabled?: (path: string) => boolean;
};

export const buildQuickMoveDestinations = ({
  favoritePaths, recentPaths, matches, scope, isDestinationDisabled,
}: DestinationOptions): QuickMoveDestination[] => {
  if (!scope.scopeRoots.length) return [];
  const favorites = new Set(favoritePaths.map(folderPathKey));
  const selectedRoots = new Set(scope.scopeRoots);
  const search = withoutVerbatimPrefix(scope.search.replace(/\//g, "\\")).toLowerCase();
  const added = new Set<string>();
  const destinations: QuickMoveDestination[] = [];

  const add = (path: string, name: string, section: QuickMoveSection) => {
    const key = folderPathKey(path);
    const root = getQuickMoveDriveRoot(path);
    if (added.has(key) || !root || !selectedRoots.has(root)) return;
    if (section !== "Matches") {
      const normalizedPath = withoutVerbatimPrefix(key);
      const relative = normalizedPath.slice(root.length);
      if (scope.maxDepth != null && relative && relative.split("\\").length > scope.maxDepth) return;
      if (search && !name.toLowerCase().includes(search) && !normalizedPath.toLowerCase().includes(search)) return;
    }
    added.add(key);
    destinations.push({ path, name, key, section, favorite: favorites.has(key), disabled: Boolean(isDestinationDisabled?.(path)) });
  };

  for (const path of favoritePaths) add(path, getPathName(path) || path, "Favourites");
  for (const path of recentPaths) add(path, getPathName(path) || path, "Recent");
  for (const { path, name, kind } of matches) {
    if (kind === "directory") add(path, name, "Matches");
  }
  return destinations;
};
