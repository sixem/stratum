// Builds per-directory view data shared by list/grid, selection, and typeahead.
import { useMemo } from "react";
import type { TypeaheadItem } from "./useTypeaheadSelection";
import type { FileEntry } from "@/types";
import type { EntryItem } from "@/lib";

export type FileViewModel = {
  items: EntryItem[];
  itemPaths: string[];
  indexMap: Map<string, number>;
  entryByPath: Map<string, FileEntry>;
  typeaheadItems: TypeaheadItem[];
  parentPath: string | null;
};

export const useFileViewModel = (
  entries: FileEntry[],
  parentPath: string | null,
): FileViewModel => {
  return useMemo(() => {
    const items: EntryItem[] = [];
    const itemPaths: string[] = [];
    const indexMap = new Map<string, number>();
    const entryByPath = new Map<string, FileEntry>();
    const typeaheadItems: TypeaheadItem[] = [];

    // Build items and lookup tables together so folder refreshes do one pass.
    const pushItem = (item: EntryItem, index: number) => {
      items.push(item);
      const path = item.type === "parent" ? item.path : item.entry.path;
      itemPaths.push(path);
      indexMap.set(path, index);
      if (item.type === "entry") {
        entryByPath.set(item.entry.path, item.entry);
        typeaheadItems.push({
          path: item.entry.path,
          index,
          label: item.entry.name.toLowerCase(),
        });
      }
    };

    if (parentPath) {
      pushItem(
        {
          key: `parent:${parentPath}`,
          type: "parent",
          path: parentPath,
        },
        0,
      );
    }

    entries.forEach((entry, offset) => {
      const index = parentPath ? offset + 1 : offset;
      pushItem(
        {
          key: entry.path,
          type: "entry",
          entry,
        },
        index,
      );
    });

    return {
      items,
      itemPaths,
      indexMap,
      entryByPath,
      typeaheadItems,
      parentPath,
    };
  }, [entries, parentPath]);
};
