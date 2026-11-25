// Display the current bindings only on menus whose view handles the shortcuts.
import { formatKeybind, type KeybindAction, type KeybindMap } from "@/modules/keybinds";
import type { ContextMenuItem } from "@/types";

const actions: Partial<Record<string, KeybindAction>> = {
  "entry-rename": "renameSelection",
  "entry-delete": "deleteSelection",
  "entry-copy-to-other-pane": "copyToOtherPane",
  "entry-move-to-other-pane": "moveToOtherPane",
  "select-same-extension": "selectSameExtension",
  "invert-selection": "invertSelection",
  "entry-quick-move": "quickMove",
};

export function withContextMenuShortcuts(items: ContextMenuItem[], keybinds: KeybindMap): ContextMenuItem[] {
  return items.map((item) => {
    if (item.kind === "divider") return item;
    if (item.kind === "submenu") return { ...item, items: withContextMenuShortcuts(item.items, keybinds) };
    const action = actions[item.id];
    return action ? { ...item, hint: formatKeybind(keybinds[action]) || undefined } : item;
  });
}
