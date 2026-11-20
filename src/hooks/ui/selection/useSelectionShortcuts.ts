// Handles keyboard navigation and selection activation in the file view.
import { useEffect } from "react";
import type { RefObject } from "react";
import { tinykeys } from "tinykeys";
import { isEditableElement } from "@/lib";
import { useBottomPaneStore } from "@/modules/bottomPaneStore";
import type { ViewMode } from "@/types";
import { useSmartTabJump } from "./useSmartTabJump";
import { moveFileSelection } from "./moveFileSelection";

type SelectionTarget = {
  path: string;
  isDir: boolean;
};

type UseSelectionShortcutsOptions = {
  blockReveal: boolean;
  previewOpen: boolean;
  contextMenuOpen: boolean;
  loading: boolean;
  settingsOpen: boolean;
  indexedSearchOpen: boolean;
  smartTabBlocked: boolean;
  viewMode: ViewMode;
  smartTabJump: boolean;
  mainRef: RefObject<HTMLElement | null>;
  gridColumnsRef: RefObject<number>;
  selectionItems: string[];
  getSelectionIndex: () => number;
  selectItem: (
    path: string,
    index: number,
    modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  ) => void;
  requestScrollToIndex: (index: number) => void;
  getSelectionTarget: () => SelectionTarget | null;
  onOpenDir: (path: string) => void | Promise<void>;
  onOpenEntry: (path: string) => void | Promise<void>;
};

export const useSelectionShortcuts = ({
  blockReveal,
  previewOpen,
  contextMenuOpen,
  loading,
  settingsOpen,
  indexedSearchOpen,
  smartTabBlocked,
  viewMode,
  smartTabJump,
  mainRef,
  gridColumnsRef,
  selectionItems,
  getSelectionIndex,
  selectItem,
  requestScrollToIndex,
  getSelectionTarget,
  onOpenDir,
  onOpenEntry,
}: UseSelectionShortcutsOptions) => {
  const handleTabJump = useSmartTabJump(mainRef);

  useEffect(() => {
    const handleArrow = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (useBottomPaneStore.getState().active) return;
      if (settingsOpen || contextMenuOpen || indexedSearchOpen) return;
      if (previewOpen) return;
      if (loading || blockReveal) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;

      const main = mainRef.current;
      const hasMainFocus = Boolean(main && active && main.contains(active));
      const isRootFocus =
        !active || active === document.body || active === document.documentElement;
      if (!hasMainFocus && !isRootFocus) return;

      if (moveFileSelection(event, viewMode, gridColumnsRef.current, selectionItems, getSelectionIndex(), selectItem, requestScrollToIndex)) {
        event.preventDefault();
      }
    };

    const unsubscribe = tinykeys(window, {
      ArrowUp: handleArrow,
      ArrowDown: handleArrow,
      ArrowLeft: handleArrow,
      ArrowRight: handleArrow,
    });

    return () => unsubscribe();
  }, [
    blockReveal,
    previewOpen,
    contextMenuOpen,
    gridColumnsRef,
    loading,
    mainRef,
    getSelectionIndex,
    requestScrollToIndex,
    selectItem,
    selectionItems,
    settingsOpen,
    indexedSearchOpen,
    viewMode,
  ]);

  useEffect(() => {
    if (!smartTabJump) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen || contextMenuOpen || indexedSearchOpen || smartTabBlocked) return;
      if (previewOpen || loading || blockReveal || useBottomPaneStore.getState().active) return;
      if (!handleTabJump(event)) return;

      // Suppress normal focus traversal so double-tap stays scoped to the view.
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    blockReveal,
    contextMenuOpen,
    loading,
    handleTabJump,
    previewOpen,
    settingsOpen,
    indexedSearchOpen,
    smartTabBlocked,
    smartTabJump,
  ]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Enter") return;
      if (useBottomPaneStore.getState().active) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.repeat || event.isComposing) return;
      if (settingsOpen || contextMenuOpen || indexedSearchOpen) return;
      if (previewOpen) return;
      if (loading) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;

      const main = mainRef.current;
      const hasMainFocus = Boolean(main && active && main.contains(active));
      const isRootFocus =
        !active || active === document.body || active === document.documentElement;
      if (!hasMainFocus && !isRootFocus) return;

      const target = getSelectionTarget();
      if (!target) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      if (target.isDir) {
        void onOpenDir(target.path);
      } else {
        void onOpenEntry(target.path);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    contextMenuOpen,
    getSelectionTarget,
    loading,
    mainRef,
    onOpenDir,
    onOpenEntry,
    previewOpen,
    settingsOpen,
    indexedSearchOpen,
  ]);
};
