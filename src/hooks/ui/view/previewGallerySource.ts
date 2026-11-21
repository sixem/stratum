// Builds a gallery snapshot from the media selected in the current file view.
import { isPreviewableEntry } from "@/lib/fileKind";
import type { EntryContextTarget, FileEntry } from "@/types";

export type PreviewGallerySource = {
  items: FileEntry[];
  entryByPath: Map<string, FileEntry>;
  onSelectPath?: (path: string) => void;
};

// A menu opened from a mixed selection can still start on one of its media files.
export const resolveGalleryStartPath = (
  target: EntryContextTarget,
  paths: readonly string[],
  entryByPath: ReadonlyMap<string, FileEntry>,
) => {
  if (isPreviewableEntry(target)) return target.path;
  for (const path of paths) {
    const entry = entryByPath.get(path);
    if (entry && isPreviewableEntry(entry)) return path;
  }
};

export const scopeGalleryToSelection = (
  gallery: PreviewGallerySource,
  path: string,
  selected?: ReadonlySet<string>,
): PreviewGallerySource => {
  if (!selected || selected.size < 2 || !selected.has(path)) return gallery;

  // Keep the displayed order and leave the pane selection intact as the gallery advances.
  const items = gallery.items.filter((entry) => selected.has(entry.path) && isPreviewableEntry(entry));
  return { items, entryByPath: new Map(items.map((entry) => [entry.path, entry])) };
};
