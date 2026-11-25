// Reuse the visible entry map from list/grid so filters and sort order apply.
import { getExtension } from "@/lib/fileKind";
import type { ContextMenuItem, EntryContextTarget, FileEntry } from "@/types";

type SelectionChange = (paths: string[], anchor?: string) => void;
type VisibleEntries = ReadonlyMap<string, FileEntry>;

function getSelectionExtension(entries: VisibleEntries, path?: string) {
  const entry = path ? entries.get(path) : undefined;
  return entry && !entry.isDir ? getExtension(entry.name) : null;
}

export function selectFolderExtension(entries: VisibleEntries, onSelectionChange: SelectionChange, path?: string) {
  const extension = getSelectionExtension(entries, path);
  if (!extension) return false;
  const paths: string[] = [];
  for (const entry of entries.values()) {
    if (!entry.isDir && getExtension(entry.name) === extension) paths.push(entry.path);
  }
  onSelectionChange(paths, path);
  return true;
}

export function invertFolderSelection(entries: VisibleEntries, selected: ReadonlySet<string>, onSelectionChange: SelectionChange) {
  if (!entries.size) return false;
  const paths = [...entries.keys()].filter((path) => !selected.has(path));
  onSelectionChange(paths, paths[0]);
  return true;
}

export function buildFolderSelectionItems(
  entries: VisibleEntries,
  selected: ReadonlySet<string>,
  onSelectionChange: SelectionChange,
  target?: EntryContextTarget,
): ContextMenuItem[] {
  if (!entries.size) return [];

  const items: ContextMenuItem[] = [{
    id: "invert-selection",
    label: "Invert selection",
    icon: "invert-selection",
    onSelect: () => invertFolderSelection(entries, selected, onSelectionChange),
  }];
  const extension = getSelectionExtension(entries, target?.path);
  if (extension) {
    items.unshift({
      id: "select-same-extension",
      label: `Select all .${extension} files`,
      icon: "select-same-extension",
      onSelect: () => selectFolderExtension(entries, onSelectionChange, target?.path),
    });
  }
  return items;
}
