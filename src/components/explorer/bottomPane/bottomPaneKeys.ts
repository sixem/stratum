// Route keyboard actions to the tabs and selection of the focused lower pane.
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { REOPEN_CLOSED_TAB_KEYBIND } from "@/constants";
import { formatDeleteLabel, isEditableElement } from "@/lib";
import { releaseInputFocusOnEscape } from "@/hooks/ui/inputs/inputFocus";
import { focusOtherFilePane } from "@/hooks/ui/inputs/focusOtherFilePane";
import { focusSplitTerminal } from "@/hooks/ui/inputs/focusSplitTerminal";
import type { PaneFileCommands } from "@/hooks/ui/app/useAppContextMenus";
import { handleSearchHotkey } from "@/hooks/ui/inputs/useSearchHotkey";
import { moveFileSelection } from "@/hooks/ui/selection/moveFileSelection";
import { buildKeybindFromEvent, useIndexedSearchUiStore, useSettingsStore, usePromptStore, writeFileClipboard } from "@/modules";
import { openQuickMove, useQuickMoveSession } from "@/modules/quickMoveSession";
import type { EntryContextTarget } from "@/types";
import type { PaneActions } from "./BottomPane";
import type { useBottomFolder } from "./useBottomFolder";

type Options = {
  folder: ReturnType<typeof useBottomFolder>;
  actions: PaneActions;
  address: RefObject<HTMLInputElement | null>;
  files: RefObject<HTMLDivElement | null>;
  searchInput: RefObject<HTMLInputElement | null>;
  clearSearchAndFocusFiles: () => void;
  browseFromView: (path: string) => void;
  openContextMenu: (native: boolean) => boolean;
  paths: string[];
  ready: boolean;
  commandsBlocked: boolean;
  gridColumns: RefObject<number>;
  closeTab: (id: string) => void;
  startRename: (item: EntryContextTarget) => void;
  clearSelection: () => void;
  undo: () => Promise<void>;
  moveEntries: (paths: string[], destination: string) => void;
  paneFileCommands: PaneFileCommands;
  scrollTo: (index: number) => void;
  handleTypeahead: (event: KeyboardEvent) => boolean;
  handleTabJump: (event: KeyboardEvent) => boolean;
};

export function bottomPaneKeys({
  folder, actions, address, files, searchInput, clearSearchAndFocusFiles, browseFromView,
  openContextMenu, paths, ready, commandsBlocked, gridColumns, closeTab,
  startRename, clearSelection, undo, moveEntries, paneFileCommands, scrollTo, handleTypeahead, handleTabJump,
}: Options) {
  const { dir, tabs, model, selection } = folder;
  const navigate = tabs.browseTo;
  const path = dir.currentPath;
  return (event: ReactKeyboardEvent<HTMLElement>) => {
    // Menus use a portal. Their keystrokes are handled before reaching this pane.
    if (!event.currentTarget.contains(event.target as Node)) return;
    const binding = buildKeybindFromEvent(event.nativeEvent);
    const { keybinds, confirmDelete, smartTabJump } = useSettingsStore.getState();
    // Indexed search belongs to the window, even when the lower pane has focus.
    if (binding === keybinds.openIndexedSearch) return;
    event.stopPropagation();
    if (commandsBlocked || usePromptStore.getState().prompt || useIndexedSearchUiStore.getState().open ||
        useQuickMoveSession.getState().request) return;
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (releaseInputFocusOnEscape(event.nativeEvent, files.current)) return;
    if (handleSearchHotkey(event, searchInput.current, clearSearchAndFocusFiles)) return;
    if (event.repeat && !event.key.startsWith("Arrow")) return;
    const cmd = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    const key = event.key.toLowerCase();
    if (binding === REOPEN_CLOSED_TAB_KEYBIND) tabs.reopenClosedTab();
    else if (binding === keybinds.newTab) tabs.newTab();
    else if (binding === keybinds.closeTab && tabs.activeTabId) closeTab(tabs.activeTabId);
    else if (cmd && key === "l") { address.current?.focus(); address.current?.select(); }
    else if ((binding === "Control+Tab" || binding === "Control+Shift+Tab" ||
        binding === keybinds.prevTab || binding === keybinds.nextTab) && tabs.tabs.length) {
      const n = tabs.tabs.length;
      const i = tabs.tabs.findIndex(tab => tab.id === tabs.activeTabId);
      const backward = binding === "Control+Shift+Tab" || binding === keybinds.prevTab;
      tabs.selectTab(tabs.tabs[(i + (backward ? n - 1 : 1)) % n].id);
    } else if (cmd && /^[1-9]$/.test(key)) {
      const tab = tabs.tabs[Number(key) - 1];
      if (tab) tabs.selectTab(tab.id);
    } else if (binding === "F5" || binding === "Control+r") {
      const tabPath = tabs.activeTab?.path;
      if (!ready && !dir.loadingPath && tabPath) {
        void dir.loadDir(tabPath, { sort: tabs.sortState, search: tabs.searchValue, force: true });
      } else if (ready) {
        void dir.refresh();
      }
    } else if (isEditableElement(event.target as Element)) return;
    else if (binding === "ContextMenu" || binding === "Shift+F10") {
      if (!openContextMenu(binding === "Shift+F10")) return;
    } else if (binding === keybinds.focusOtherPane) {
      if (!focusOtherFilePane("bottom")) return;
    } else if (binding === keybinds.focusSplitTerminal) {
      if (!focusSplitTerminal(files.current)) return;
    }
    else if (!ready) return;
    else if (binding === keybinds.quickMove) {
      if (!openQuickMove(paths, moveEntries)) return;
    }
    // These gestures also work after a tab or toolbar button has taken focus.
    else if (handleTypeahead(event.nativeEvent) || (smartTabJump && handleTabJump(event.nativeEvent))) {
      event.preventDefault();
      return;
    } else if (event.target !== event.currentTarget && !(event.target as Element).closest("[data-pane-path]")) return;
    else if (cmd && key === "a") selection.setSelection(model.itemPaths, model.itemPaths[0]);
    else if (paths.length && cmd && (key === "c" || key === "x")) void writeFileClipboard(paths, key === "x" ? "move" : "copy");
    else if (cmd && key === "v") void actions.pasteEntries(path);
    else if (binding === keybinds.undo) void undo();
    else if (key === "escape") clearSelection();
    else if (binding === keybinds.duplicateSelection && paths.length) void actions.duplicateEntries(paths, path);
    else if (binding === keybinds.copyToOtherPane || binding === keybinds.moveToOtherPane) {
      if (!paneFileCommands.transfer(binding === keybinds.copyToOtherPane ? "copy" : "move", paths)) return;
    } else if (binding === keybinds.selectSameExtension) {
      if (!paneFileCommands.selectSameExtension(selection.getSelectionTarget()?.path)) return;
    } else if (binding === keybinds.invertSelection) {
      if (!paneFileCommands.invertSelection()) return;
    }
    else if (binding === keybinds.deleteSelection && paths.length) {
      const remove = () => { void actions.deleteEntries(paths).then(report => { if (report?.deleted) clearSelection(); }); };
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
    } else if (binding === keybinds.renameSelection && paths.length) {
      const entry = model.entryByPath.get(selection.getSelectionTarget()?.path ?? "") ?? model.entryByPath.get(paths[0]);
      if (!entry) return;
      startRename(entry);
    } else if (key === "backspace" && dir.parentPath) {
      navigate(dir.parentPath);
    } else if (key === "enter" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const target = selection.getSelectionTarget();
      if (target?.isDir) browseFromView(target.path);
      else if (target) void actions.openEntry(target.path);
    } else if (!moveFileSelection(
      event.nativeEvent, tabs.viewMode, gridColumns.current, model.itemPaths,
      selection.getSelectionIndex(), selection.selectItem, scrollTo,
    )) return;
    event.preventDefault();
  };
}
