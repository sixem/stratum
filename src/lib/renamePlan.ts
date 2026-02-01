// Rename planning helpers for single and bulk rename operations.
import type { FileEntry } from "@/types";
import { splitNameExtension } from "./fileName";

type RenamePlanItem = {
  path: string;
  nextName: string;
};

const orderSelectionByView = (targets: string[], indexMap: Map<string, number>) => {
  const ordered = [...targets];
  ordered.sort((left, right) => {
    const leftIndex = indexMap.get(left) ?? Number.POSITIVE_INFINITY;
    const rightIndex = indexMap.get(right) ?? Number.POSITIVE_INFINITY;
    return leftIndex - rightIndex;
  });
  return ordered;
};

export const buildBulkRenamePlan = (
  baseName: string,
  targets: string[],
  entryByPath: Map<string, FileEntry>,
  entries: FileEntry[],
  indexMap: Map<string, number>,
) => {
  const ordered = orderSelectionByView(targets, indexMap);
  const targetSet = new Set(ordered);
  // Reserve names that already exist in the directory but are not part of the rename set.
  const reserved = new Set<string>();
  entries.forEach((entry) => {
    if (targetSet.has(entry.path)) return;
    reserved.add(entry.name.trim().toLowerCase());
  });

  const plan: RenamePlanItem[] = [];
  ordered.forEach((path, index) => {
    const entry = entryByPath.get(path);
    if (!entry) return;
    const dotExtension = entry.isDir ? "" : splitNameExtension(entry.name).dotExtension ?? "";
    // Match Explorer-style numbering: first keeps base, then (1), (2), etc.
    let suffixIndex = index === 0 ? 0 : index;
    let candidate = "";
    while (true) {
      const suffix = suffixIndex > 0 ? ` (${suffixIndex})` : "";
      candidate = `${baseName}${suffix}${dotExtension}`;
      const key = candidate.trim().toLowerCase();
      if (!key) {
        suffixIndex += 1;
        continue;
      }
      if (!reserved.has(key)) {
        reserved.add(key);
        break;
      }
      suffixIndex += 1;
    }

    if (candidate !== entry.name) {
      plan.push({ path: entry.path, nextName: candidate });
    } else {
      reserved.add(candidate.trim().toLowerCase());
    }
  });

  return { ordered, plan };
};

export const getRenameInputValue = (
  target: { name: string; isDir: boolean },
  hideExtension: boolean,
) => {
  if (!hideExtension || target.isDir) return target.name;
  return splitNameExtension(target.name).base;
};

export const applyHiddenExtension = (
  nextName: string,
  originalName: string,
  hideExtension: boolean,
  isDir: boolean,
) => {
  if (!hideExtension || isDir) return nextName;
  const { dotExtension } = splitNameExtension(originalName);
  if (!dotExtension) return nextName;
  const trimmed = nextName.trim();
  if (trimmed.toLowerCase().endsWith(dotExtension.toLowerCase())) {
    return trimmed;
  }
  return `${trimmed}${dotExtension}`;
};
