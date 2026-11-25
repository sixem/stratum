// Manages rename state and commit logic for single + bulk renames.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { EntryContextTarget, FileEntry, RenameCommitReason } from "@/types";
import { applyHiddenExtension, getSelectionTargets } from "@/lib";
import type { RenameRequest } from "@/hooks/domain/filesystem/fileManager.types";
import { useBatchRenameStore } from "@/modules/batchRenameStore";

type UseAppRenameFlowOptions = {
  viewVisit: RefObject<boolean>;
  entryByPath: Map<string, FileEntry>;
  indexMap: Map<string, number>;
  selected: Set<string>;
  viewParentPath: string | null;
  gridNameHideExtension: boolean;
  renameEntry: (path: string, nextName: string, options: Pick<RenameRequest, "updateFolderLocations">) => Promise<string | null | undefined>;
  renameEntries: (
    renames: RenameRequest[],
  ) => Promise<{ renamed: Map<string, string> } | null | undefined>;
  setSelection: (paths: string[], anchor?: string) => void;
};

type RenameSelection = {
  paths: string[];
  anchor: string;
  visit: RefObject<boolean>;
};

export const useAppRenameFlow = ({
  viewVisit,
  entryByPath,
  indexMap,
  selected,
  viewParentPath,
  gridNameHideExtension,
  renameEntry,
  renameEntries,
  setSelection,
}: UseAppRenameFlowOptions) => {
  const [renameTarget, setRenameTarget] = useState<EntryContextTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSelection, setRenameSelection] = useState<RenameSelection | null>(null);
  const renameCommitRef = useRef(false);

  // Restore selection against the refreshed listing, including any active filter.
  useEffect(() => {
    if (!renameSelection) return;
    if (renameSelection.visit === viewVisit && viewVisit.current) {
      setSelection(renameSelection.paths, renameSelection.anchor);
    }
    setRenameSelection(null);
  }, [renameSelection, setSelection, viewVisit]);

  const handleRenameCancel = useCallback(() => {
    setRenameTarget(null);
    setRenameValue("");
  }, []);

  const tryStartBatchRename = useCallback((target: EntryContextTarget) => {
    if (!selected.has(target.path) || selected.size < 2) return false;
    // Use the visible sort order and hold a snapshot while the dialog is open.
    const ordered = getSelectionTargets(selected, viewParentPath)
      .sort((left, right) => (
        (indexMap.get(left) ?? indexMap.size) - (indexMap.get(right) ?? indexMap.size)
      ));
    const items = ordered.flatMap((path) => {
      const entry = entryByPath.get(path);
      return entry ? [{ path, name: entry.name, isDir: entry.isDir }] : [];
    });
    if (items.length < 2) return false;
    useBatchRenameStore.getState().open({
      items,
      onApply: async (requests) => {
        if (!viewVisit.current) throw new Error("The original folder is no longer open in this pane.");
        if (renameCommitRef.current) throw new Error("Another rename is already in progress.");
        renameCommitRef.current = true;
        try {
          const result = await renameEntries(requests.map(request => ({
            ...request, updateFolderLocations: entryByPath.get(request.path)?.isDir,
          })));
          if (!result) throw new Error("Another rename is already in progress.");
          if (result.renamed.size && viewVisit.current) {
            setRenameSelection({
              paths: items.map(({ path }) => result.renamed.get(path) ?? path),
              anchor: result.renamed.get(target.path) ?? target.path,
              visit: viewVisit,
            });
          }
        } finally {
          renameCommitRef.current = false;
        }
      },
    });
    return true;
  }, [entryByPath, indexMap, renameEntries, selected, viewParentPath, viewVisit]);

  const handleRenameCommit = useCallback(
    (reason: RenameCommitReason = "enter") => {
      if (!renameTarget) return;
      if (renameCommitRef.current) return;
      const nextName = renameValue.trim();
      const originalName = renameTarget.name.trim();
      setRenameTarget(null);
      setRenameValue("");
      const hideExtension = gridNameHideExtension && !renameTarget.isDir;
      const resolvedNextName = applyHiddenExtension(
        nextName,
        renameTarget.name,
        hideExtension,
        renameTarget.isDir,
      );
      if (!resolvedNextName || resolvedNextName === originalName) return;
      const shouldSelect = reason === "enter";
      renameCommitRef.current = true;
      void renameEntry(renameTarget.path, resolvedNextName, { updateFolderLocations: renameTarget.isDir })
        .then((nextPath) => {
          if (!nextPath || !shouldSelect || !viewVisit.current) return;
          setRenameSelection({ paths: [nextPath], anchor: nextPath, visit: viewVisit });
        })
        .finally(() => {
          renameCommitRef.current = false;
        });
    },
    [
      gridNameHideExtension,
      renameEntry,
      renameTarget,
      renameValue,
      viewVisit,
    ],
  );

  return {
    renameTarget,
    renameValue,
    setRenameTarget,
    setRenameValue,
    handleRenameCommit,
    handleRenameCancel,
    tryStartBatchRename,
  };
};
