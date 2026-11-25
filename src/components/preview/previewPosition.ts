// Index the gallery's ordered snapshot once. Case-sensitive folders can contain
// multiple entries with the same normalized path, so check the exact path first.
import { normalizePath } from "../../lib/paths.ts";

export const createPreviewPositionLookup = (items: readonly { path: string }[]) => {
  const positions = new Map<string, number>();
  for (let index = items.length - 1; index >= 0; index--) {
    positions.set(items[index].path, index);
  }

  return (path: string) => {
    const exact = positions.get(path);
    if (exact !== undefined) return exact;
    const normalized = normalizePath(path);
    return normalized ? items.findIndex((item) => normalizePath(item.path) === normalized) : -1;
  };
};
