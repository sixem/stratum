// Centralizes keybind gating and handlers for the main app shell.
import { useCallback, useMemo } from "react";
import { copyPathsToClipboard } from "@/api";
import { formatDeleteLabel, getSelectionTargets, isEditableElement } from "@/lib";
import { useKeybinds } from "../inputs/useKeybinds";
import { useClipboardStore, usePromptStore } from "@/modules";
import type { KeybindMap } from "@/modules/keybinds";
import type { Tab } from "@/types";

type UseAppKeybindsOptions = {
  keybinds: KeybindMap;
  confirmDelete: boolean;
  settingsOpen: boolean;
  conversionModalOpen: boolean;
  contextMenuOpen: boolean;
  promptOpen: boolean;
  previewOpen: boolean;
  blockReveal: boolean;
  activeTabId: string | null;
  tabs: Tab[];
  selected: Set<string>;
  viewParentPath: string | null;
  canUndo: () => boolean;
  undo: () => Promise<unknown>;
  deleteEntries: (paths: string[]) => Promise<{ deleted: number } | null | undefined>;
  duplicateEntries: (paths: string[]) => Promise<unknown>;
  pasteEntries: (paths: string[], destination?: string) => Promise<unknown>;
  refreshClipboardFromOs: () => Promise<string[] | null>;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onSelectTab: (id: string) => void;
  onRefresh: () => void;
  onClearSelection: () => void;
  hasTransientUi?: boolean;
  onCancelTransientUi?: () => void;
  onSelectAll: () => void;
};

export const useAppKeybinds = ({
  keybinds,
  confirmDelete,
  settingsOpen,
  conversionModalOpen,
  contextMenuOpen,
  promptOpen,
  previewOpen,
  blockReveal,
  activeTabId,
  tabs,
  selected,
  viewParentPath,
  canUndo,
  undo,
  deleteEntries,
  duplicateEntries,
  pasteEntries,
  refreshClipboardFromOs,
  onNewTab,
  onCloseTab,
  onSelectTab,
  onRefresh,
  onClearSelection,
  hasTransientUi = false,
  onCancelTransientUi,
  onSelectAll,
}: UseAppKeybindsOptions) => {
  const selectionTargets = useMemo(
    () => getSelectionTargets(selected, viewParentPath),
    [selected, viewParentPath],
  );

  // Keybind gating helpers: protect interactions during modal states.
  const canHandleGlobalKeybind = useCallback(() => {
    return !settingsOpen && !conversionModalOpen && !contextMenuOpen && !promptOpen && !previewOpen;
  }, [contextMenuOpen, conversionModalOpen, previewOpen, promptOpen, settingsOpen]);

  const canHandleViewKeybind = useCallback(() => {
    if (!canHandleGlobalKeybind()) return false;
    if (blockReveal) return false;
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

  const handleDuplicateSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (selectionTargets.length === 0) return false;
    void duplicateEntries(selectionTargets);
    return true;
  }, [canHandleViewKeybind, duplicateEntries, selectionTargets]);

  const handlePreviewItemKeybind = useCallback((_event: KeyboardEvent) => {
    return false;
  }, []);

  const handleCopySelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    if (selectionTargets.length === 0) return false;
    useClipboardStore.getState().setClipboard(selectionTargets);
    void copyPathsToClipboard(selectionTargets);
    return true;
  }, [canHandleViewKeybind, selectionTargets]);

  const handlePasteSelectionKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleViewKeybind()) return false;
    const clipboard = useClipboardStore.getState().clipboard;
    if (clipboard && clipboard.paths.length > 0) {
      void pasteEntries(clipboard.paths);
      return true;
    }
    void refreshClipboardFromOs().then((paths) => {
      if (!paths || paths.length === 0) return;
      void pasteEntries(paths);
    });
    return true;
  }, [canHandleViewKeybind, pasteEntries, refreshClipboardFromOs]);

  const handleRefreshKeybind = useCallback((_event: KeyboardEvent) => {
    if (!canHandleGlobalKeybind()) return false;
    onRefresh();
    return true;
  }, [canHandleGlobalKeybind, onRefresh]);

  const keybindHandlers = useMemo(
    () => ({
      undo: handleUndoKeybind,
      newTab: handleNewTabKeybind,
      closeTab: handleCloseTabKeybind,
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
      handlePreviewItemKeybind,
      handleUndoKeybind,
    ],
  );

  const reservedKeybinds = useMemo(
    () => {
      const map: Record<string, (event: KeyboardEvent) => boolean> = {
        Escape: handleClearSelectionKeybind,
        F5: handleRefreshKeybind,
        "Control+a": handleSelectAllKeybind,
        "Control+c": handleCopySelectionKeybind,
        "Control+v": handlePasteSelectionKeybind,
        "Control+r": handleRefreshKeybind,
      };
      for (let index = 1; index <= 9; index += 1) {
        map[`Control+${index}`] = () => handleSelectTabIndex(index);
      }
      return map;
    },
    [
      handleClearSelectionKeybind,
      handleCopySelectionKeybind,
      handlePasteSelectionKeybind,
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
