// Coordinates selection, typeahead navigation, and grid column tracking for the file view.
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import type { ViewMode } from "@/types";
import type { FileViewModel } from "./useFileViewModel";
import { useFileViewSelection } from "./useFileViewSelection";
import { useTypeaheadSelection } from "./useTypeaheadSelection";

type UseFileViewInteractionsOptions = {
  viewModel: FileViewModel;
  activeTabId: string | null;
  currentPath: string;
  deferredSearchValue: string;
  viewMode: ViewMode;
  blockReveal: boolean;
  loading: boolean;
  settingsOpen: boolean;
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
  blockReveal,
  loading,
  settingsOpen,
  contextMenuOpen,
  mainRef,
  requestScrollToIndex,
}: UseFileViewInteractionsOptions) => {
  const gridColumnsRef = useRef(1);
  const handleGridColumnsChange = useCallback((columns: number) => {
    gridColumnsRef.current = columns;
  }, []);
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

  const handleTypeaheadMatch = useCallback(
    (item: { path: string; index: number }) => {
      setSelection([item.path], item.path);
      requestScrollToIndex(item.index);
    },
    [requestScrollToIndex, setSelection],
  );

  const shouldHandleTypeahead = useCallback(
    (activeElement: Element | null) => {
      if (settingsOpen || contextMenuOpen) return false;
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
    [blockReveal, contextMenuOpen, loading, mainRef, settingsOpen],
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
