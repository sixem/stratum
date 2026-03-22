// Small shared helpers for entry context-menu builders.

import type { EntryContextTarget, FileEntry } from "@/types";

export const resolveActionError = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export const resolveContextTargets = (
  target: EntryContextTarget,
  selected: Set<string>,
  parentPath: string | null,
) => {
  // Prefer the current selection when the right-clicked entry is already selected.
  const useSelection = selected.has(target.path);
  const base = useSelection ? Array.from(selected) : [target.path];
  const filtered = parentPath ? base.filter((path) => path !== parentPath) : base;
  return filtered.length > 0 ? filtered : [target.path];
};

export const resolveMenuEntry = (
  path: string,
  target: EntryContextTarget,
  entryByPath: Map<string, FileEntry>,
) => {
  if (path === target.path) return target;
  return entryByPath.get(path) ?? null;
};
