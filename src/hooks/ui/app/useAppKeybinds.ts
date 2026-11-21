// Centralizes keybind gating and handlers for the main app shell.
import { useCallback, useMemo } from "react";
import type { RefObject } from "react";
import { REOPEN_CLOSED_TAB_KEYBIND } from "@/constants";
import { formatDeleteLabel, getDriveKey, getSelectionTargets, isEditableElement, normalizeDropPath } from "@/lib";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import { getFileCommandFocus } from "../menus/keyboardContextMenu";
import { useKeybinds } from "../inputs/useKeybinds";
import { useIndexedSearchUiStore, usePromptStore, writeFileClipboard } from "@/modules";
import type { KeybindMap } from "@/modules/keybinds";
import type { Tab } from "@/types";

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
}: UseAppKeybindsOptions) => {
  const indexedSearchOpen = useIndexedSearchUiStore((state) => state.open);
  const selectionTargets = useMemo(
    () => getSelectionTargets(selected, viewParentPath),
    [selected, viewParentPath],
  );

  // Keybind gating helpers: protect interactions during modal states.
  const modalOpen = settingsOpen || aboutOpen || conversionModalOpen ||
    promptOpen || previewOpen || indexedSearchOpen;
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
    (_event: KeyboardEvent, direction: -1 | 1) => {
      if (!canHandleGlobalKeybind()) return false;
      if (!activeTabId || tabs.length < 2) return false;
      const index = tabs.findIndex((tab) => tab.id === activeTabId);
      if (index < 0) return false;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= tabs.length) return false;
      const target = tabs[nextIndex];
      if (!target) return false;
      onSelectTab(target.id);
      return true;
    },
    [activeTabId, canHandleGlobalKeybind, onSelectTab, tabs],
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

  const handleDeleteSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
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
  }, [canHandleViewKeybind, confirmDelete, deleteEntries, onClearSelection, selectionTargets]);

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
    if (event.isComposing || !canHandleViewKeybind() || !selectionTargets.length) return false;
    if (getFileCommandFocus(mainRef.current) !== "view") return false;
    return onRenameSelection(selectionTargets);
  }, [canHandleViewKeybind, mainRef, onRenameSelection, selectionTargets]);

  const handleDuplicateSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (selectionTargets.length === 0) return false;
    void duplicateEntries(selectionTargets);
    return true;
  }, [canHandleViewKeybind, duplicateEntries, selectionTargets]);

  const handlePreviewItemKeybind = useCallback((_event: KeyboardEvent) => {
    return false;
  }, []);

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
    return (contextMenuOpen || canHandleViewKeybind()) && onContextMenu(native);
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
      deleteSelection: handleDeleteSelectionKeybind,
      duplicateSelection: handleDuplicateSelectionKeybind,
      previewItem: handlePreviewItemKeybind,
      prevTab: (event: KeyboardEvent) => handleAdjacentTab(event, -1),
      nextTab: (event: KeyboardEvent) => handleAdjacentTab(event, 1),
    }),
    [
      handleAdjacentTab,
      handleCloseTabKeybind,
      handleDeleteSelectionKeybind,
      handleDuplicateSelectionKeybind,
      handleNewTabKeybind,
      handleOpenIndexedSearchKeybind,
      handlePreviewItemKeybind,
      handleUndoKeybind,
    ],
  );

  const reservedKeybinds = useMemo(
    () => {
      const map: Record<string, (event: KeyboardEvent) => boolean> = {
        Escape: handleClearSelectionKeybind,
        F2: handleRenameSelectionKeybind,
        F5: handleRefreshKeybind,
        "Control+a": handleSelectAllKeybind,
        "Control+c": () => handleClipboardSelection("copy"),
        "Control+x": () => handleClipboardSelection("move"),
        "Control+v": handlePasteSelectionKeybind,
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
      handleClearSelectionKeybind,
      handleClipboardSelection,
      handleContextMenuKeybind,
      handlePasteSelectionKeybind,
      handleReopenClosedTabKeybind,
      handleRefreshKeybind,
      handleRenameSelectionKeybind,
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
