// Walk each row once, skipping metadata already supplied by the listing or cache.
import type { EntryMeta, FileEntry } from "@/types";

export const nextMetadataBatch = (
  entries: FileEntry[],
  cursor: number,
  known: ReadonlyMap<string, EntryMeta>,
  limit: number,
) => {
  const paths: string[] = [];
  while (cursor < entries.length && paths.length < limit) {
    const entry = entries[cursor++];
    if (!entry.isDir && entry.size == null && entry.modified == null && !known.has(entry.path)) {
      paths.push(entry.path);
    }
  }
  return { paths, cursor };
};
