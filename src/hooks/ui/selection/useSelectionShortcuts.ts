// Handles keyboard navigation and selection activation in the file view.
import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { tinykeys } from "tinykeys";
import { isEditableElement } from "@/lib";
import type { ViewMode } from "@/types";

type SelectionTarget = {
  path: string;
  isDir: boolean;
};

type UseSelectionShortcutsOptions = {
  blockReveal: boolean;
  contextMenuOpen: boolean;
  loading: boolean;
  settingsOpen: boolean;
  viewMode: ViewMode;
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
  contextMenuOpen,
  loading,
  settingsOpen,
  viewMode,
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
  const lastTabTapRef = useRef(0);
  const TAB_DOUBLE_TAP_MS = 280;

  const moveSelectionBy = useCallback(
    (delta: number, event: KeyboardEvent) => {
      if (selectionItems.length === 0) return false;
      const maxIndex = selectionItems.length - 1;
      const currentIndex = getSelectionIndex();
      const nextIndex =
        currentIndex < 0
          ? delta > 0
            ? 0
            : maxIndex
          : Math.min(maxIndex, Math.max(0, currentIndex + delta));
      if (currentIndex >= 0 && nextIndex === currentIndex) {
        return true;
      }
      const path = selectionItems[nextIndex];
      if (!path) return false;
      selectItem(path, nextIndex, {
        shiftKey: event.shiftKey,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      });
      requestScrollToIndex(nextIndex);
      return true;
    },
    [getSelectionIndex, requestScrollToIndex, selectItem, selectionItems],
  );

  useEffect(() => {
    const handleArrow = (
      event: KeyboardEvent,
      direction: "up" | "down" | "left" | "right",
    ) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing) return;
      if (settingsOpen || contextMenuOpen) return;
      if (loading || blockReveal) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;

      const main = mainRef.current;
      const hasMainFocus = Boolean(main && active && main.contains(active));
      const isRootFocus =
        !active || active === document.body || active === document.documentElement;
      if (!hasMainFocus && !isRootFocus) return;

      let delta = 0;
      if (viewMode === "list") {
        if (direction === "left" || direction === "right") return;
        delta = direction === "up" ? -1 : 1;
      } else {
        const columns = Math.max(1, gridColumnsRef.current);
        if (direction === "up") delta = -columns;
        else if (direction === "down") delta = columns;
        else if (direction === "left") delta = -1;
        else delta = 1;
      }

      if (moveSelectionBy(delta, event)) {
        event.preventDefault();
      }
    };

    const unsubscribe = tinykeys(window, {
      ArrowUp: (event: KeyboardEvent) => handleArrow(event, "up"),
      ArrowDown: (event: KeyboardEvent) => handleArrow(event, "down"),
      ArrowLeft: (event: KeyboardEvent) => handleArrow(event, "left"),
      ArrowRight: (event: KeyboardEvent) => handleArrow(event, "right"),
    });

    return () => unsubscribe();
  }, [
    blockReveal,
    contextMenuOpen,
    gridColumnsRef,
    loading,
    mainRef,
    moveSelectionBy,
    settingsOpen,
    viewMode,
  ]);

  useEffect(() => {
    const handleTabJump = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Tab") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.repeat) return;
      if (settingsOpen || contextMenuOpen) return;
      if (loading || blockReveal) return;

      const active = document.activeElement;
      if (isEditableElement(active)) return;
      if (!document.hasFocus()) return;

      const main = mainRef.current;
      const hasMainFocus = Boolean(main && active && main.contains(active));
      const isRootFocus =
        !active || active === document.body || active === document.documentElement;
      if (!hasMainFocus && !isRootFocus) return;

      // Suppress normal focus traversal so double-tap stays scoped to the view.
      event.preventDefault();
      event.stopPropagation();

      const now = performance.now();
      const elapsed = now - lastTabTapRef.current;
      lastTabTapRef.current = now;
      if (elapsed > TAB_DOUBLE_TAP_MS) return;

      const scrollHost =
        main?.querySelector<HTMLElement>(".list-body") ??
        main?.querySelector<HTMLElement>(".thumb-viewport");
      if (!scrollHost) return;
      const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
      if (maxScrollTop <= 0) return;
      const ratio = scrollHost.scrollTop / maxScrollTop;
      scrollHost.scrollTop = ratio < 0.5 ? maxScrollTop : 0;
    };

    window.addEventListener("keydown", handleTabJump);
    return () => window.removeEventListener("keydown", handleTabJump);
  }, [blockReveal, contextMenuOpen, loading, mainRef, settingsOpen]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Enter") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.repeat || event.isComposing) return;
      if (settingsOpen || contextMenuOpen) return;
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
    settingsOpen,
  ]);
};
