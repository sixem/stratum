// Snapshot previewable search results in the same order as the result list.
import type { PreviewGallerySource } from "@/hooks/ui/view/useQuickPreview";
import { isPreviewableEntry } from "@/lib";
import type { FileEntry, IndexedPathMatch } from "@/types";

export const buildIndexedSearchGallery = (
  results: IndexedPathMatch[],
  selectResult: (result: IndexedPathMatch) => void,
): PreviewGallerySource => {
  const items: FileEntry[] = [];
  const entryByPath = new Map<string, FileEntry>();
  for (const result of results) {
    const entry: FileEntry = {
      path: result.path,
      name: result.name,
      isDir: result.kind === "directory",
      size: null,
      modified: null,
    };
    if (!isPreviewableEntry(entry)) continue;
    items.push(entry);
    entryByPath.set(entry.path, entry);
  }
  return {
    items,
    entryByPath,
    onSelectPath: (path) => {
      const result = results.find((match) => match.path === path);
      if (result) selectResult(result);
    },
  };
};
