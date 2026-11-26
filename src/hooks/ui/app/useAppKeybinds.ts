// Centralizes keybind gating and handlers for the main app shell.
import { useCallback, useMemo } from "react";
import type { RefObject } from "react";
import { REOPEN_CLOSED_TAB_KEYBIND } from "@/constants";
import { formatDeleteLabel, getAdjacentTab, getDriveKey, getSelectionTargets, isEditableElement, normalizeDropPath } from "@/lib";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { resizeThumbnails } from "@/modules/resizeThumbnails";
import { useSessionStore } from "@/modules/sessionStore";
import { getFileCommandFocus } from "../menus/keyboardContextMenu";
import { focusOtherFilePane } from "../inputs/focusOtherFilePane";
import { focusSplitTerminal } from "../inputs/focusSplitTerminal";
import { useKeybinds } from "../inputs/useKeybinds";
import { useIndexedSearchUiStore, usePromptStore, useSettingsStore, writeFileClipboard } from "@/modules";
import { openQuickMove } from "@/modules/quickMoveSession";
import type { KeybindMap } from "@/modules/keybinds";
import type { Tab } from "@/types";
import type { PaneFileCommands } from "./useAppContextMenus";

type UseAppKeybindsOptions = {
  keybinds: KeybindMap;
  indexedSearchEnabled: boolean;
  confirmDelete: boolean;
  settingsOpen: boolean;
  aboutOpen: boolean;
  conversionModalOpen: boolean;
  contextMenuOpen: boolean;
  promptOpen: boolean;
  previewOpen: boolean;
  quickMoveOpen: boolean;
  blockReveal: boolean;
  activeTabId: string | null;
  tabs: Tab[];
  selected: Set<string>;
  mainRef: RefObject<HTMLElement | null>;
  currentPath: string;
  viewParentPath: string | null;
  canUndo: () => boolean;
  undo: () => Promise<unknown>;
  deleteEntries: (paths: string[]) => Promise<{ deleted: number } | null | undefined>;
  duplicateEntries: (paths: string[]) => Promise<unknown>;
  moveEntries: (paths: string[], destination: string) => void;
  pasteEntries: (destination?: string) => Promise<unknown>;
  onContextMenu: (native: boolean) => boolean;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onReopenClosedTab: () => boolean;
  onSelectTab: (id: string) => void;
  onRefresh: () => void;
  onClearSelection: () => void;
  hasTransientUi?: boolean;
  onCancelTransientUi?: () => void;
  onSelectAll: () => void;
  onRenameSelection: (paths: string[]) => boolean;
  paneFileCommands: PaneFileCommands;
  getSelectionTarget: () => { path: string } | null;
};

export const useAppKeybinds = ({
  keybinds,
  indexedSearchEnabled,
  confirmDelete,
  settingsOpen,
  aboutOpen,
  conversionModalOpen,
  contextMenuOpen,
  promptOpen,
  previewOpen,
  quickMoveOpen,
  blockReveal,
  activeTabId,
  tabs,
  selected,
  mainRef,
  currentPath,
  viewParentPath,
  canUndo,
  undo,
  deleteEntries,
  duplicateEntries,
  moveEntries,
  pasteEntries,
  onContextMenu,
  onNewTab,
  onCloseTab,
  onReopenClosedTab,
  onSelectTab,
  onRefresh,
  onClearSelection,
  hasTransientUi = false,
  onCancelTransientUi,
  onSelectAll,
  onRenameSelection,
  paneFileCommands,
  getSelectionTarget,
}: UseAppKeybindsOptions) => {
  const indexedSearchOpen = useIndexedSearchUiStore((state) => state.open);
  const selectionTargets = useMemo(
    () => getSelectionTargets(selected, viewParentPath),
    [selected, viewParentPath],
  );

  // Keybind gating helpers: protect interactions during modal states.
  const modalOpen = settingsOpen || aboutOpen || conversionModalOpen ||
    promptOpen || previewOpen || indexedSearchOpen || quickMoveOpen;
  const canHandleGlobalKeybind = useCallback(
    () => !modalOpen && !contextMenuOpen,
    [modalOpen, contextMenuOpen],
  );

  const canHandleViewKeybind = useCallback(() => {
    if (!canHandleGlobalKeybind()) return false;
    if (blockReveal || useBottomPaneStore.getState().active) return false;
    const active = document.activeElement;
    if (isEditableElement(active)) return false;
    return true;
  }, [blockReveal, canHandleGlobalKeybind]);

  const canHandlePaneCommand = useCallback((event: KeyboardEvent) =>
    !event.isComposing && canHandleViewKeybind() && getFileCommandFocus(mainRef.current) === "view",
  [canHandleViewKeybind, mainRef]);

  // Keybind handlers are kept explicit for readability and testing.
  const handleNewTabKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleGlobalKeybind()) return false;
    onNewTab();
    return true;
  }, [canHandleGlobalKeybind, onNewTab]);

  const handleCloseTabKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleGlobalKeybind()) return false;
    if (!activeTabId) return false;
    onCloseTab(activeTabId);
    return true;
  }, [activeTabId, canHandleGlobalKeybind, onCloseTab]);

  const handleReopenClosedTabKeybind = useCallback((event: KeyboardEvent) => {
    if (!canHandleGlobalKeybind() || event.isComposing || useBottomPaneStore.getState().active) return false;
    return onReopenClosedTab();
  }, [canHandleGlobalKeybind, onReopenClosedTab]);

  const handleAdjacentTab = useCallback(
    (direction: -1 | 1) => {
      if (!canHandleGlobalKeybind()) return false;
      if (!tabs.length || (activeTabId && tabs.length < 2)) return false;
      const target = getAdjacentTab(tabs, activeTabId, direction, useSettingsStore.getState().wrapTabNavigation);
      if (!target) return true;
      // Move focus before the terminal input is detached so subsequent keys stay in this pane.
      if (document.activeElement?.closest("[data-terminal]")) {
        mainRef.current?.focus({ preventScroll: true });
      }
      onSelectTab(target.id);
      return true;
    },
    [activeTabId, canHandleGlobalKeybind, mainRef, onSelectTab, tabs],
  );

  const handleSelectTabIndex = useCallback(
    (index: number) => {
      if (!canHandleGlobalKeybind()) return false;
      const target = tabs[index - 1];
      if (!target) return false;
      onSelectTab(target.id);
      return true;
    },
    [canHandleGlobalKeybind, onSelectTab, tabs],
  );

  const handleUndoKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (!canUndo()) return false;
    void undo();
    return true;
  }, [canHandleViewKeybind, canUndo, undo]);

  const handleDeleteSelectionKeybind = useCallback((event: KeyboardEvent) => {
    if (!canHandlePaneCommand(event)) return false;
    if (selectionTargets.length === 0) return false;
    const runDelete = () => {
      void deleteEntries(selectionTargets).then((report) => {
        if (report?.deleted) {
          onClearSelection();
        }
      });
    };
    if (!confirmDelete) {
      runDelete();
      return true;
    }
    const label = formatDeleteLabel(selectionTargets);
    usePromptStore.getState().showPrompt({
      title: selectionTargets.length === 1 ? "Delete item?" : "Delete items?",
      content: `Delete ${label}? Items may be moved to the Recycle Bin when available.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      onConfirm: runDelete,
    });
    return true;
  }, [canHandlePaneCommand, confirmDelete, deleteEntries, onClearSelection, selectionTargets]);

  const handleClearSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    let handled = false;
    if (selected.size > 0) {
      onClearSelection();
      handled = true;
    }
    if (hasTransientUi) {
      onCancelTransientUi?.();
      handled = true;
    }
    return handled;
  }, [
    canHandleViewKeybind,
    hasTransientUi,
    onCancelTransientUi,
    onClearSelection,
    selected.size,
  ]);

  const handleSelectAllKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    onSelectAll();
    return true;
  }, [canHandleViewKeybind, onSelectAll]);

  const handleRenameSelectionKeybind = useCallback((event: KeyboardEvent) => {
    if (!canHandlePaneCommand(event) || !selectionTargets.length) return false;
    return onRenameSelection(selectionTargets);
  }, [canHandlePaneCommand, onRenameSelection, selectionTargets]);

  const handleDuplicateSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (selectionTargets.length === 0) return false;
    void duplicateEntries(selectionTargets);
    return true;
  }, [canHandleViewKeybind, duplicateEntries, selectionTargets]);

  const handleQuickMoveKeybind = useCallback((event: KeyboardEvent) => {
    if (event.isComposing || !canHandleViewKeybind()) return false;
    return openQuickMove(selectionTargets, moveEntries);
  }, [canHandleViewKeybind, moveEntries, selectionTargets]);

  const handlePreviewItemKeybind = useCallback((_event: KeyboardEvent) => {
    return false;
  }, []);

  const resizeGrid = useCallback((direction: -1 | 1) =>
    canHandleViewKeybind() && Boolean(mainRef.current?.querySelector(".thumb-viewport")) &&
    resizeThumbnails(direction, useSessionStore, activeTabId),
  [activeTabId, canHandleViewKeybind, mainRef]);

  const handleClipboardSelection = useCallback((operation: "copy" | "move") => {
    if (!canHandleViewKeybind()) return false;
    const focus = getFileCommandFocus(mainRef.current);
    if (!focus) return false;
    const paths = focus === "view" ? selectionTargets : [focus.place.path];
    if (!paths.length) return false;
    if (operation === "move" && focus !== "view") {
      const path = normalizeDropPath(focus.place.path);
      const root = getDriveKey(path);
      if (!root || root === path) return false;
    }
    void writeFileClipboard(paths, operation);
    return true;
  }, [canHandleViewKeybind, mainRef, selectionTargets]);

  const handlePasteSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    const focus = getFileCommandFocus(mainRef.current);
    if (!focus) return false;
    const destination = focus === "view" ? currentPath : focus.place.path;
    if (!destination) return false;
    void pasteEntries(destination);
    return true;
  }, [canHandleViewKeybind, currentPath, mainRef, pasteEntries]);

  const handleContextMenuKeybind = useCallback((native: boolean) => {
    if (modalOpen) return false;
    const sidebarFocused = Boolean(document.activeElement?.closest(".sidebar [data-context-place]"));
    return (contextMenuOpen || sidebarFocused || canHandleViewKeybind()) && onContextMenu(native);
  }, [canHandleViewKeybind, contextMenuOpen, modalOpen, onContextMenu]);

  const handleRefreshKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleGlobalKeybind()) return false;
    onRefresh();
    return true;
  }, [canHandleGlobalKeybind, onRefresh]);

  const handleOpenIndexedSearchKeybind = useCallback((_event: KeyboardEvent) => {
    if (!indexedSearchEnabled) {
      return false;
    }
    if (indexedSearchOpen) {
      return true;
    }
    if (modalOpen || contextMenuOpen) {
      return true;
    }
    useIndexedSearchUiStore.getState().openModal();
    return true;
  }, [
    contextMenuOpen,
    indexedSearchOpen,
    indexedSearchEnabled,
    modalOpen,
  ]);

  const keybindHandlers = useMemo(
    () => ({
      undo: handleUndoKeybind,
      newTab: handleNewTabKeybind,
      closeTab: handleCloseTabKeybind,
      openIndexedSearch: handleOpenIndexedSearchKeybind,
      quickMove: handleQuickMoveKeybind,
      deleteSelection: handleDeleteSelectionKeybind,
      renameSelection: handleRenameSelectionKeybind,
      duplicateSelection: handleDuplicateSelectionKeybind,
      copyToOtherPane: (event: KeyboardEvent) => canHandlePaneCommand(event) && paneFileCommands.transfer("copy", selectionTargets),
      moveToOtherPane: (event: KeyboardEvent) => canHandlePaneCommand(event) && paneFileCommands.transfer("move", selectionTargets),
      selectSameExtension: (event: KeyboardEvent) => canHandlePaneCommand(event) && paneFileCommands.selectSameExtension(getSelectionTarget()?.path),
      invertSelection: (event: KeyboardEvent) => canHandlePaneCommand(event) && paneFileCommands.invertSelection(),
      focusOtherPane: (event: KeyboardEvent) => !event.isComposing && canHandleViewKeybind() && focusOtherFilePane("main"),
      focusSplitTerminal: (event: KeyboardEvent) => !event.isComposing && canHandleGlobalKeybind() &&
        !useBottomPaneStore.getState().active && !isEditableElement(document.activeElement) && focusSplitTerminal(mainRef.current),
      previewItem: handlePreviewItemKeybind,
      prevTab: () => !isEditableElement(document.activeElement) && handleAdjacentTab(-1),
      nextTab: () => !isEditableElement(document.activeElement) && handleAdjacentTab(1),
      increaseThumbnailSize: () => resizeGrid(1),
      decreaseThumbnailSize: () => resizeGrid(-1),
    }),
    [
      canHandleGlobalKeybind,
      canHandlePaneCommand,
      canHandleViewKeybind,
      getSelectionTarget,
      handleAdjacentTab,
      handleCloseTabKeybind,
      handleDeleteSelectionKeybind,
      handleDuplicateSelectionKeybind,
      handleNewTabKeybind,
      handleOpenIndexedSearchKeybind,
      handlePreviewItemKeybind,
      handleQuickMoveKeybind,
      handleRenameSelectionKeybind,
      handleUndoKeybind,
      mainRef,
      paneFileCommands,
      resizeGrid,
      selectionTargets,
    ],
  );

  const reservedKeybinds = useMemo(
    () => {
      const map: Record<string, (event: KeyboardEvent) => boolean> = {
        Escape: handleClearSelectionKeybind,
        F5: handleRefreshKeybind,
        "Control+a": handleSelectAllKeybind,
        "Control+c": () => handleClipboardSelection("copy"),
        "Control+x": () => handleClipboardSelection("move"),
        "Control+v": handlePasteSelectionKeybind,
        "Control+Tab": () => handleAdjacentTab(1),
        "Control+Shift+Tab": () => handleAdjacentTab(-1),
        [REOPEN_CLOSED_TAB_KEYBIND]: handleReopenClosedTabKeybind,
        ContextMenu: () => handleContextMenuKeybind(false),
        "Shift+F10": () => handleContextMenuKeybind(true),
        "Control+r": handleRefreshKeybind,
      };
      for (let index = 1; index <= 9; index += 1) {
        map[`Control+${index}`] = () => handleSelectTabIndex(index);
      }
      return map;
    },
    [
      handleAdjacentTab,
      handleClearSelectionKeybind,
      handleClipboardSelection,
      handleContextMenuKeybind,
      handlePasteSelectionKeybind,
      handleReopenClosedTabKeybind,
      handleRefreshKeybind,
      handleSelectAllKeybind,
      handleSelectTabIndex,
    ],
  );

  useKeybinds({
    keybinds,
    handlers: keybindHandlers,
    reserved: reservedKeybinds,
  });
};
