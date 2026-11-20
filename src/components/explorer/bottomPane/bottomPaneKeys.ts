// Route keyboard actions to the tabs and selection of the focused lower pane.
import type { KeyboardEvent, RefObject } from "react";
import { formatDeleteLabel, isEditableElement } from "@/lib";
import { buildKeybindFromEvent, useSettingsStore, usePromptStore, writeFileClipboard } from "@/modules";
import type { useWindowsContextMenu } from "@/hooks/ui/menus/useWindowsContextMenu";
import type { PaneActions } from "./BottomPane";
import type { useBottomFolder } from "./useBottomFolder";

type Options = {
  folder: ReturnType<typeof useBottomFolder>;
  actions: PaneActions;
  address: RefObject<HTMLInputElement | null>;
  nativeMenu: ReturnType<typeof useWindowsContextMenu>;
  paths: string[];
  ready: boolean;
  startRename: (item: {path: string; name: string}) => void;
  scrollTo: (index: number) => void;
};

export function bottomPaneKeys({ folder, actions, address, nativeMenu, paths, ready, startRename, scrollTo }: Options) {
  const { dir, tabs, model, selection } = folder;
  const navigate = tabs.browseTo;
  const path = dir.currentPath;
  return (event: KeyboardEvent<HTMLElement>) => {
    // Window-wide shortcuts belong to the upper pane. Keep lower-pane commands
    // local, including text-editing shortcuts in its address and rename fields.
    if (!event.currentTarget.contains(event.target as Node) || usePromptStore.getState().prompt) return;
    const binding = buildKeybindFromEvent(event.nativeEvent);
    const { keybinds, confirmDelete } = useSettingsStore.getState();
    // Indexed search belongs to the window, even when the lower pane has focus.
    if (binding === keybinds.openIndexedSearch) return;
    event.stopPropagation();
    if (isEditableElement(event.target as Element) || event.defaultPrevented) return;
    if (event.repeat && !event.key.startsWith("Arrow")) return;
    const cmd = event.ctrlKey && !event.altKey && !event.metaKey;
    const key = event.key.toLowerCase();
    if (binding === keybinds.newTab) tabs.newTab();
    else if (binding === keybinds.closeTab && tabs.activeTabId) tabs.closeTab(tabs.activeTabId);
    else if (cmd && key === "l") { address.current?.focus(); address.current?.select(); }
    else if (((cmd && key === "tab") || binding === keybinds.prevTab || binding === keybinds.nextTab) && tabs.tabs.length) {
      const n = tabs.tabs.length;
      const i = tabs.tabs.findIndex(tab => tab.id === tabs.activeTabId);
      const backward = event.shiftKey || binding === keybinds.prevTab;
      tabs.selectTab(tabs.tabs[(i + (backward ? n - 1 : 1)) % n].id);
    } else if (cmd && /^[1-9]$/.test(key)) {
      const tab = tabs.tabs[Number(key) - 1];
      if (tab) tabs.selectTab(tab.id);
    } else if (key === "f5" || binding === "Control+r") void dir.refresh();
    else if (!ready || (event.target !== event.currentTarget && !(event.target as Element).closest("[data-pane-path]"))) return;
    else if (cmd && key === "a") selection.setSelection(Array.from(model.entryByPath.keys()));
    else if (paths.length && cmd && (key === "c" || key === "x")) void writeFileClipboard(paths, key === "x" ? "move" : "copy");
    else if (cmd && key === "v") void actions.pasteEntries(path);
    else if (binding === keybinds.undo) void actions.undo();
    else if (key === "escape") selection.clearSelection();
    else if (key === "backspace" && dir.parentPath) navigate(dir.parentPath);
    else if (binding === keybinds.duplicateSelection && paths.length) void actions.duplicateEntries(paths, path);
    else if (binding === keybinds.deleteSelection && paths.length) {
      const remove = () => { void actions.deleteEntries(paths); };
      if (confirmDelete) {
        usePromptStore.getState().showPrompt({
          title: "Delete selection?",
          content: `Delete ${formatDeleteLabel(paths)}?`,
          confirmLabel: "Delete",
          cancelLabel: "Cancel",
          onConfirm: remove,
        });
      } else {
        remove();
      }
    } else if (key === "f2" && paths.length === 1) {
      const entry = model.entryByPath.get(paths[0])!;
      startRename(entry);
    } else if (key === "contextmenu" || (key === "f10" && event.shiftKey)) {
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      nativeMenu(paths.length ? {paths} : {backgroundPath: path}, {x: rect.left + 4, y: rect.top + 4});
    } else if (key === "enter" && selection.selected.size === 1) {
      const selected = selection.selected.values().next().value!;
      if (selected === dir.parentPath || model.entryByPath.get(selected)?.isDir) navigate(selected);
      else void actions.openEntry(selected);
    } else if (key === "arrowdown" || key === "arrowup") {
      const index = model.indexMap.get(selection.getAnchorPath() ?? "") ?? -1;
      const next = Math.max(0, Math.min(model.items.length-1, index + (key === "arrowup" ? -1 : 1)));
      if (model.itemPaths[next]) {
        selection.selectItem(model.itemPaths[next], next, event);
        scrollTo(next);
      }
    } else return;
    event.preventDefault();
  };
}
