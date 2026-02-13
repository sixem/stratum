// Coordinates selection, typeahead navigation, and grid column tracking for the file view.
import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ViewMode } from "@/types";
import { normalizePath } from "@/lib";
import type { FileViewModel } from "./useFileViewModel";
import { useFileViewSelection } from "../selection/useFileViewSelection";
import { useTypeaheadSelection } from "../selection/useTypeaheadSelection";

type UseFileViewInteractionsOptions = {
  viewModel: FileViewModel;
  activeTabId: string | null;
  currentPath: string;
  deferredSearchValue: string;
  viewMode: ViewMode;
  previewOpenRef: RefObject<boolean>;
  blockReveal: boolean;
  loading: boolean;
  settingsOpen: boolean;
  promptOpen: boolean;
  contextMenuOpen: boolean;
  mainRef: RefObject<HTMLElement | null>;
  requestScrollToIndex: (index: number) => void;
};

export const useFileViewInteractions = ({
  viewModel,
  activeTabId,
  currentPath,
  deferredSearchValue,
  viewMode,
  previewOpenRef,
  blockReveal,
  loading,
  settingsOpen,
  promptOpen,
  contextMenuOpen,
  mainRef,
  requestScrollToIndex,
}: UseFileViewInteractionsOptions) => {
  const gridColumnsRef = useRef(1);
  const handleGridColumnsChange = useCallback((columns: number) => {
    gridColumnsRef.current = columns;
  }, []);
  const pathKey = normalizePath(currentPath) ?? currentPath.trim();
  const selectionScopeKey =
    activeTabId && pathKey ? `${activeTabId}:${pathKey}` : null;
  const selectionResetKey = `${activeTabId ?? "none"}:${currentPath}`;
  // Reuse the shared view model so selection + typeahead stay in sync.
  const {
    selected,
    selectItem,
    clearSelection,
    setSelection,
    selectionItems,
    getSelectionIndex,
    getSelectionTarget,
    handleSelectItem,
  } = useFileViewSelection({
    viewModel,
    resetKey: selectionResetKey,
  });
  type SelectionSnapshot = {
    paths: string[];
    anchor: string | null;
  };
  const selectionCacheRef = useRef<Map<string, SelectionSnapshot>>(new Map());
  const activeScopeRef = useRef<string | null>(null);
  const pendingRestoreScopeRef = useRef<string | null>(null);
  const pendingRestoreRef = useRef<SelectionSnapshot | null>(null);

  useEffect(() => {
    if (activeScopeRef.current === selectionScopeKey) return;
    const previousScope = activeScopeRef.current;
    if (previousScope) {
      // Save outgoing selection so switching away from a tab/path can restore later.
      if (selected.size > 0) {
        selectionCacheRef.current.set(previousScope, {
          paths: Array.from(selected),
          anchor: null,
        });
      } else {
        selectionCacheRef.current.delete(previousScope);
      }
    }
    activeScopeRef.current = selectionScopeKey;
    pendingRestoreScopeRef.current = selectionScopeKey;
    pendingRestoreRef.current = selectionScopeKey
      ? selectionCacheRef.current.get(selectionScopeKey) ?? null
      : null;
  }, [selected, selectionScopeKey]);

  useEffect(() => {
    if (!selectionScopeKey) return;
    if (pendingRestoreScopeRef.current !== selectionScopeKey) return;
    const pendingSelection = pendingRestoreRef.current;
    if (!pendingSelection) return;
    if (loading) return;
    const validPaths = pendingSelection.paths.filter((path) =>
      viewModel.indexMap.has(path),
    );
    if (validPaths.length > 0) {
      setSelection(validPaths, pendingSelection.anchor ?? validPaths[validPaths.length - 1]);
    }
    // One-shot restore: once applied (or discarded), wait until this scope is left again.
    selectionCacheRef.current.delete(selectionScopeKey);
    pendingRestoreRef.current = null;
    pendingRestoreScopeRef.current = null;
  }, [loading, selectionScopeKey, setSelection, viewModel.indexMap]);

  const handleTypeaheadMatch = useCallback(
    (item: { path: string; index: number }) => {
      setSelection([item.path], item.path);
      requestScrollToIndex(item.index);
    },
    [requestScrollToIndex, setSelection],
  );

  const shouldHandleTypeahead = useCallback(
    (activeElement: Element | null) => {
      if (settingsOpen || contextMenuOpen || promptOpen) return false;
      // Block typeahead while quick preview is active to avoid stealing focus.
      if (previewOpenRef.current) return false;
      if (loading || blockReveal) return false;
      const main = mainRef.current;
      if (!main) return false;
      const hasMainFocus = Boolean(activeElement && main.contains(activeElement));
      const isRootFocus =
        !activeElement ||
        activeElement === document.body ||
        activeElement === document.documentElement;
      if (!hasMainFocus && !isRootFocus) {
        // Keep focus in the view so typeahead navigation is predictable.
        main.focus({ preventScroll: true });
      }
      return true;
    },
    [blockReveal, contextMenuOpen, loading, mainRef, previewOpenRef, promptOpen, settingsOpen],
  );

  useTypeaheadSelection({
    items: viewModel.typeaheadItems,
    onMatch: handleTypeaheadMatch,
    shouldHandle: shouldHandleTypeahead,
    resetKeys: [currentPath, deferredSearchValue, viewMode],
  });

  return {
    gridColumnsRef,
    handleGridColumnsChange,
    selected,
    selectItem,
    clearSelection,
    setSelection,
    selectionItems,
    getSelectionIndex,
    getSelectionTarget,
    handleSelectItem,
  };
};
