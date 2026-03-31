// Coordinates selection changes with rename lifecycle so they stay in sync.
import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { EntryContextTarget, RenameCommitReason } from "@/types";
import { getRenameInputValue } from "@/lib";

type UseAppSelectionHandlersOptions = {
  renameTarget: EntryContextTarget | null;
  selected: Set<string>;
  gridNameHideExtension: boolean;
  setSelection: (paths: string[], anchor?: string) => void;
  clearSelection: () => void;
  onAfterClearSelection?: () => void;
  handleSelectItem: (path: string, index: number, event: ReactMouseEvent) => void;
  handleRenameCommit: (reason?: RenameCommitReason) => void;
  setRenameTarget: (target: EntryContextTarget | null) => void;
  setRenameValue: (value: string) => void;
};

export const useAppSelectionHandlers = ({
  renameTarget,
  selected,
  gridNameHideExtension,
  setSelection,
  clearSelection,
  onAfterClearSelection,
  handleSelectItem,
  handleRenameCommit,
  setRenameTarget,
  setRenameValue,
}: UseAppSelectionHandlersOptions) => {
  // Cancel inline rename when the selection moves away from the rename target.
  const handleSelectionChange = useCallback(
    (paths: string[], anchor?: string) => {
      if (renameTarget && !paths.includes(renameTarget.path)) {
        handleRenameCommit("blur");
      }
      setSelection(paths, anchor);
    },
    [handleRenameCommit, renameTarget, setSelection],
  );

  const handleClearSelection = useCallback(() => {
    if (renameTarget) {
      handleRenameCommit("blur");
    }
    clearSelection();
    onAfterClearSelection?.();
  }, [clearSelection, handleRenameCommit, onAfterClearSelection, renameTarget]);

  const handleSelectItemWithRename = useCallback(
    (path: string, index: number, event: ReactMouseEvent) => {
      if (renameTarget && renameTarget.path !== path) {
        handleRenameCommit("blur");
      }
      handleSelectItem(path, index, event);
    },
    [handleRenameCommit, handleSelectItem, renameTarget],
  );

  const handleRenameStart = useCallback(
    (target: EntryContextTarget) => {
      if (!target?.path) return;
      if (!selected.has(target.path)) {
        handleSelectionChange([target.path], target.path);
      }
      setRenameTarget(target);
      setRenameValue(getRenameInputValue(target, gridNameHideExtension));
    },
    [gridNameHideExtension, handleSelectionChange, selected, setRenameTarget, setRenameValue],
  );

  return {
    handleSelectionChange,
    handleClearSelection,
    handleSelectItemWithRename,
    handleRenameStart,
  };
};
