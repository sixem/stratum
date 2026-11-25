// Map related menu entries to the same visibility option across explorer surfaces.
import type { ContextMenuItem } from "@/types";

export const CONTEXT_MENU_ACTION_GROUPS = [
  {
    label: "Opening items",
    description: "Choose how files and folders can be opened from the menu.",
    keywords: "open in bottom pane open in main pane",
    actions: [
      { id: "open", label: "Open", items: ["entry-open", "place-target-open"] },
      { id: "open-with", label: "Open with", items: ["entry-open-with"] },
      { id: "open-gallery", label: "Open in gallery", items: ["entry-open-gallery"] },
      { id: "open-tab", label: "Open in new tab", items: ["entry-open-new-tab", "place-target-open-new-tab"] },
      { id: "open-pane", label: "Open in other pane", items: ["entry-open-other-pane", "place-target-open-other-pane"] },
      { id: "open-parent-folder", label: "Open parent folder", items: ["place-target-open-parent"] },
      { id: "open-search-location", label: "Open result location", items: ["indexed-open-current-tab", "indexed-open-containing-folder"] },
    ],
  },
  {
    label: "Clipboard",
    description: "Choose the clipboard actions shown in the menu.",
    actions: [
      { id: "cut", label: "Cut", items: ["entry-cut"] },
      { id: "copy", label: "Copy", items: ["entry-copy", "place-target-copy"] },
      { id: "copy-text", label: "Copy as text", items: ["entry-copy-as-text", "place-target-copy-path"] },
      { id: "paste", label: "Paste", items: ["entry-paste", "layout-paste", "place-target-paste"] },
    ],
  },
  {
    label: "File and folder actions",
    description: "Choose the actions available on selected items.",
    actions: [
      { id: "move-to", label: "Move to", items: ["entry-move-to"] },
      { id: "group-selection", label: "New folder with selection", items: ["entry-new-folder-with-selection"] },
      { id: "rename", label: "Rename", items: ["entry-rename", "place-target-rename-folder"] },
      { id: "delete", label: "Delete", items: ["entry-delete"] },
      { id: "properties", label: "Properties", items: ["entry-properties", "place-target-properties"] },
    ],
  },
  {
    label: "Folder background",
    description: "Choose the commands shown on empty space and list headers.",
    actions: [
      { id: "new-folder", label: "New folder", items: ["layout-new-folder"] },
      { id: "new-file", label: "New file", items: ["layout-new-file"] },
      { id: "sort", label: "Sort", items: ["sort-name", "sort-size", "sort-modified"] },
      { id: "columns", label: "Columns", items: ["list-columns"] },
    ],
  },
  {
    label: "Pinned and recent places",
    description: "Choose which sidebar and folder location actions appear.",
    actions: [
      { id: "add-place", label: "Add to places", items: ["place-target-add"] },
      { id: "pin-place", label: "Pin or unpin", items: ["place-target-pin", "place-target-pin-toggle"] },
      { id: "rename-place", label: "Rename place", items: ["place-target-rename-place"] },
      { id: "remove-place", label: "Remove from places", items: ["place-target-remove"] },
      { id: "remove-recent", label: "Remove from recent jumps", items: ["place-target-remove-recent"] },
    ],
  },
] as const;

export type ContextMenuAction = typeof CONTEXT_MENU_ACTION_GROUPS[number]["actions"][number]["id"];

const actions = CONTEXT_MENU_ACTION_GROUPS.flatMap<{
  id: ContextMenuAction; items: readonly string[];
}>((group) => group.actions);
const knownActions = new Set<string>(actions.map(({ id }) => id));
const actionByItemId = new Map(actions.flatMap(({ id, items }) => items.map((item) => [item, id] as const)));

export function coerceHiddenContextMenuActions(value: unknown): ContextMenuAction[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is ContextMenuAction => typeof id === "string" && knownActions.has(id)))];
}

export function applyContextMenuVisibility(items: ContextMenuItem[], hidden: readonly ContextMenuAction[]): ContextMenuItem[] {
  const hiddenActions = new Set(hidden);
  const visible: ContextMenuItem[] = [];
  let divider: ContextMenuItem | undefined;

  for (const item of items) {
    if (item.kind === "divider") {
      if (visible.length) divider ??= item;
      continue;
    }
    const action = actionByItemId.get(item.id);
    if (action && hiddenActions.has(action)) continue;
    if (divider) visible.push(divider);
    divider = undefined;
    visible.push(item);
  }
  return visible;
}
