// Transfer a directory's relative path between two linked Windows folder roots.
import { joinPath } from "./dropPaths.ts";
import { folderPathKey } from "./paths.ts";

export type LinkedPane = "main" | "bottom";

export type PaneLink = {
  mainTabId: string;
  mainRootPath: string;
  bottomTabId: string;
  bottomRootPath: string;
};

const linkedPathKey = (path: string) => {
  const key = folderPathKey(path)
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\([a-z]:)/i, "$1");
  const isAbsolute = /^[a-z]:\\/i.test(key) ||
    /^\\\\(?![?.]\\)[^\\]+\\[^\\]+(?:\\|$)/.test(key) ||
    /^\\\\\?\\Volume\{[a-f0-9-]+\}(?:\\|$)/i.test(key);
  // Relative input and dot segments do not provide a stable linked root.
  return isAbsolute && !key.split("\\").some((part) => /^\.{1,2}\s*$/.test(part)) ? key : null;
};

export const relativeLinkedPath = (root: string, folder: string) => {
  const rootKey = linkedPathKey(root);
  const folderKey = linkedPathKey(folder);
  if (!rootKey || !folderKey) return null;
  if (rootKey === folderKey) return "";
  const prefix = rootKey.endsWith("\\") ? rootKey : rootKey + "\\";
  return folderKey.startsWith(prefix) ? folderKey.slice(prefix.length) : null;
};

export const getLinkedPaneFolder = (link: PaneLink, source: LinkedPane, folder: string) => {
  const fromRoot = source === "main" ? link.mainRootPath : link.bottomRootPath;
  const toRoot = source === "main" ? link.bottomRootPath : link.mainRootPath;
  const relative = relativeLinkedPath(fromRoot, folder);
  return relative === null ? null : relative ? joinPath(toRoot, relative) : toRoot;
};

export const coercePaneLink = (value: unknown): PaneLink | null => {
  if (!value || typeof value !== "object") return null;
  const { mainTabId, mainRootPath, bottomTabId, bottomRootPath } = value as Partial<PaneLink>;
  if (typeof mainTabId !== "string" || !mainTabId || typeof bottomTabId !== "string" || !bottomTabId ||
      typeof mainRootPath !== "string" || !linkedPathKey(mainRootPath) ||
      typeof bottomRootPath !== "string" || !linkedPathKey(bottomRootPath)) return null;
  return { mainTabId, mainRootPath, bottomTabId, bottomRootPath };
};
