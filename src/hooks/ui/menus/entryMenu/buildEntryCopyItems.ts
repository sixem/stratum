// Clipboard actions use the same Windows formats as the corresponding shortcuts.

import { getPathName } from "@/lib/paths";
import type { ContextMenuItem, EntryContextTarget, FileEntry } from "@/types";
import { writeFileClipboard } from "@/modules";
import { writeTextClipboard } from "@/modules/clipboardStore";

type TextEntry = Pick<EntryContextTarget, "name" | "path">;

type BuildEntryCopyItemsOptions = {
  actionTargets: string[];
  hasTargets: boolean;
  showShortcuts: boolean;
  target: EntryContextTarget;
  entryByPath: Map<string, FileEntry>;
  textCopyTargets?: readonly TextEntry[];
};

const getTextEntries = (paths: string[], target: EntryContextTarget, entryByPath: Map<string, FileEntry>) => {
  if (paths.length === 1 && paths[0] === target.path) return [target];
  const remaining = new Set(paths);
  const entries: TextEntry[] = [];
  // The view inserts entries in visible sort order. Selection insertion order can differ.
  for (const entry of entryByPath.values()) {
    if (remaining.delete(entry.path)) entries.push(entry);
    if (remaining.size === 0) break;
  }
  for (const path of remaining) entries.push({ path, name: getPathName(path) || path });
  return entries;
};

export const buildEntryCopyItems = ({
  actionTargets,
  hasTargets,
  showShortcuts,
  target,
  entryByPath,
  textCopyTargets,
}: BuildEntryCopyItemsOptions): ContextMenuItem[] => {
  const copyText = (key: keyof TextEntry) => {
    const entries = textCopyTargets ?? getTextEntries(actionTargets, target, entryByPath);
    void writeTextClipboard(entries.map((entry) => entry[key]).join("\r\n"));
  };

  return [
    {
      id: "entry-cut",
      label: "Cut",
      icon: "cut",
      hint: showShortcuts ? "Ctrl+X" : undefined,
      onSelect: () => { void writeFileClipboard(actionTargets, "move"); },
      disabled: !hasTargets,
    },
    {
      id: "entry-copy",
      label: "Copy",
      icon: "copy",
      hint: showShortcuts ? "Ctrl+C" : undefined,
      onSelect: () => { void writeFileClipboard(actionTargets, "copy"); },
      disabled: !hasTargets,
    },
    {
      kind: "submenu",
      id: "entry-copy-as-text",
      label: "Copy as text",
      icon: "copy",
      disabled: !hasTargets,
      items: [
        { id: "entry-copy-full-paths", label: "Full paths", icon: "copy", onSelect: () => copyText("path") },
        { id: "entry-copy-file-names", label: "File names", icon: "copy", onSelect: () => copyText("name") },
      ],
    },
  ];
};
