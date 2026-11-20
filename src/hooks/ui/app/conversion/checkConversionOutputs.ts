// Resolve output names for a batch before reserving a place in the work queue.
// The native commit checks the destination again in case another writer races the job.
import { splitNameExtension } from "../../../../lib/fileName.ts";
import { getPathName, normalizePath } from "../../../../lib/paths.ts";
import type { ConversionJobItem, ConversionOutputMode, EntryMeta } from "@/types";

export type StatOutputPaths = (paths: string[]) => Promise<EntryMeta[]>;

export async function checkConversionOutputs(
  items: ConversionJobItem[],
  mode: ConversionOutputMode,
  statEntries: StatOutputPaths,
  signal?: AbortSignal,
) {
  const reserved = new Set(items.map(item => normalizePath(item.sourcePath)));
  const nextNumbers = new Map<string, number>();
  const pending = [];
  const destinations = new Set<string>();
  for (const item of items) {
    const key = normalizePath(item.destinationPath);
    if (mode === "replace") {
      if (destinations.has(key) || (!item.options.overwrite && reserved.has(key))) {
        throw new Error(`Another selected file uses ${getPathName(item.destinationPath)}. Choose Create new to keep both files.`);
      }
      destinations.add(key);
      if (item.options.overwrite) continue; // Same file, explicitly replacing its contents.
    }
    pending.push({ item, base: item.destinationPath });
  }

  // Group metadata requests to avoid a round trip for every file on slow drives.
  let offset = 0;
  while (offset < pending.length) {
    signal?.throwIfAborted();
    const batch = pending.slice(offset, offset + 256);
    offset += batch.length;
    for (const { item, base } of batch) {
      if (mode !== "create-new") continue;
      const key = normalizePath(base);
      const { base: stem, dotExtension } = splitNameExtension(base);
      let number = nextNumbers.get(key) ?? 0;
      let candidate = base;
      do {
        if (number >= 10_000) throw new Error(`Couldn't find an unused filename for ${getPathName(base)}.`);
        candidate = number === 0 ? base : `${stem} (${number})${dotExtension}`;
        number += 1;
      } while (reserved.has(normalizePath(candidate)));
      nextNumbers.set(key, number);
      reserved.add(normalizePath(candidate));
      item.destinationPath = candidate;
    }
    const occupied = new Set(
      (await statEntries(batch.map(({ item }) => item.destinationPath)))
        .filter(entry => entry.size != null || entry.modified != null)
        .map(entry => normalizePath(entry.path)),
    );
    signal?.throwIfAborted();
    for (const entry of batch) {
      if (!occupied.has(normalizePath(entry.item.destinationPath))) continue;
      if (mode === "replace") {
        throw new Error(`${getPathName(entry.base)} already exists. Choose Create new to keep the existing file.`);
      }
      pending.push(entry);
    }
  }
}
