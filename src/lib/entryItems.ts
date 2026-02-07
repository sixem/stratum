// Maps entry data into display items for list/grid views.
import type { FileEntry } from "@/types";
import type { EntryPresence } from "./entryPresence";

export type EntryItem =
  | {
      key: string;
      type: "parent";
      path: string;
      presence?: EntryPresence;
    }
  | {
      key: string;
      type: "entry";
      entry: FileEntry;
      presence?: EntryPresence;
    };

export const isEntryItem = (
  item: EntryItem,
): item is Extract<EntryItem, { type: "entry" }> => item.type === "entry";

export const buildEntryItems = (entries: FileEntry[], parentPath: string | null): EntryItem[] => {
  const next: EntryItem[] = [];
  if (parentPath) {
    next.push({ key: `parent:${parentPath}`, type: "parent", path: parentPath });
  }
  entries.forEach((entry) => {
    next.push({ key: entry.path, type: "entry", entry });
  });
  return next;
};
