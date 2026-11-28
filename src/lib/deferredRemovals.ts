// Keep display slots separate from the authoritative directory and selection.
import type { EntryItem } from "./entryItems";
import type { SortState } from "@/types";
import { compareFolderEntries } from "./folderEntryOrder.ts";

export type RemovalLayout = { rows: EntryItem[]; pending: number };

const defaultSort: SortState = { key: "name", dir: "asc" };

export function reconcileRemovals(previous: EntryItem[], live: EntryItem[], sort = defaultSort, remote = false): RemovalLayout {
  const positions = new Map<string, number>();
  live.forEach((item, index) => positions.set(item.key, index));
  let rows: EntryItem[] | undefined;
  let next = 0, pending = 0, lastSurvivor = -1;
  for (const item of previous) {
    if (item.type === "parent") continue;
    const position = positions.get(item.key);
    if (position !== undefined) {
      lastSurvivor = position;
      continue;
    }
    rows ??= [];
    // A surviving neighbor usually locates the unchanged prefix in one comparison.
    // Its metadata may have changed, so check its current order before using it.
    if (lastSurvivor >= next) {
      const neighbor = live[lastSurvivor];
      if (neighbor.type === "entry" && compareFolderEntries(neighbor.entry, item.entry, sort, remote) <= 0) {
        while (next <= lastSurvivor) rows.push(live[next++]);
      }
    }
    // Merge additions on either side of the retained row, keeping the live order.
    while (next < live.length) {
      const row = live[next];
      if (row.type === "entry" && compareFolderEntries(row.entry, item.entry, sort, remote) >= 0) break;
      rows.push(live[next++]);
    }
    rows.push(item.presence === "pending-removal" ? item : { ...item, presence: "pending-removal" });
    pending++;
  }
  if (!rows) return { rows: live, pending: 0 };
  while (next < live.length) rows.push(live[next++]);
  return { rows, pending };
}

// Measure the actual viewport. The virtualizer also renders offscreen overscan.
export function releaseVisibleRemovals(layout: RemovalLayout, top: number, height: number,
  stride: number, rowHeight: number, columns: number, inset: number): RemovalLayout {
  if (!layout.pending || height <= 0 || stride <= 0 || columns < 1) return layout;
  const first = Math.max(0, Math.floor((top - inset - rowHeight) / stride) + 1) * columns;
  const end = Math.min(layout.rows.length, Math.max(0, Math.ceil((top + height - inset) / stride)) * columns);
  let index = first, kept = first, removed = 0;
  // Newly exposed slots can themselves be pending. Compact the visible region in one pass.
  for (; index < layout.rows.length && kept < end; index++) {
    if (layout.rows[index].presence === "pending-removal") removed++;
    else kept++;
  }
  if (!removed) return layout;
  const rows = layout.rows.slice(0, first);
  for (let i = first; i < index; i++) {
    if (layout.rows[i].presence !== "pending-removal") rows.push(layout.rows[i]);
  }
  return { rows: rows.concat(layout.rows.slice(index)), pending: layout.pending - removed };
}
