// Reuse the transfer planner's path comparisons to screen destination choices.
import { joinPath, normalizeDropPath } from "./dropPaths.ts";
import { getParentPath, getPathName } from "./paths.ts";

export const createMoveDestinationGuard = (paths: readonly string[]) => {
  const sources = paths.map((path) => ({
    name: getPathName(path),
    key: normalizeDropPath(path),
    parentKey: normalizeDropPath(getParentPath(path) ?? ""),
  }));
  return (destination: string) => {
    const key = normalizeDropPath(destination);
    if (!key || sources.every((source) => source.parentKey === key)) return true;
    return sources.some((source) => {
      const outputKey = normalizeDropPath(joinPath(destination, source.name));
      return key === source.key || key.startsWith(source.key + "\\") ||
        source.key.startsWith(outputKey + "\\");
    });
  };
};
