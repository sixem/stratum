// Each search page can open its own gallery snapshot without building it while scrolling.
import type { PreviewGallerySource } from "@/hooks/ui/view/useQuickPreview";
import type { FileEntry, IndexedPathMatch } from "@/types";
import { isPreviewableEntry } from "../../../lib/fileKind.ts";
import type { IndexedResultLookup } from "./indexedResultLookup";

const isPreviewableMatch = ({ name, kind }: IndexedPathMatch) =>
  isPreviewableEntry({ name, isDir: kind === "directory" });

export const createIndexedGalleryLookup = (
  results: readonly IndexedPathMatch[],
  indexes: IndexedResultLookup,
  selectResult: (result: IndexedPathMatch) => void,
) => {
  let gallery: PreviewGallerySource | undefined;
  const resultAtPath = (path: string) => {
    const index = indexes.get(path);
    return index === undefined ? undefined : results[index];
  };
  const onSelectPath = (path: string) => {
    const result = resultAtPath(path);
    if (result) selectResult(result);
  };

  return (path: string) => {
    if (gallery) return gallery.entryByPath.has(path) ? gallery : undefined;
    const target = resultAtPath(path);
    if (!target || !isPreviewableMatch(target)) return;

    const items: FileEntry[] = [];
    const entryByPath = new Map<string, FileEntry>();
    for (const match of results) {
      if (!isPreviewableMatch(match)) continue;
      const entry = { path: match.path, name: match.name, isDir: false, size: null, modified: null };
      items.push(entry);
      entryByPath.set(entry.path, entry);
    }
    gallery = { items, entryByPath, onSelectPath };
    return gallery;
  };
};
