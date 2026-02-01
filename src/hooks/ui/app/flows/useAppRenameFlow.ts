// Manages rename state and commit logic for single + bulk renames.
import { useCallback, useRef, useState } from "react";
import type { FileEntry, RenameCommitReason } from "@/types";
import {
  applyHiddenExtension,
  buildBulkRenamePlan,
  getSelectionTargets,
  splitNameExtension,
} from "@/lib";
import type { EntryContextTarget } from "@/types";

type UseAppRenameFlowOptions = {
  entries: FileEntry[];
  entryByPath: Map<string, FileEntry>;
  indexMap: Map<string, number>;
  selected: Set<string>;
  viewParentPath: string | null;
  gridNameHideExtension: boolean;
  renameEntry: (path: string, nextName: string) => Promise<string | null | undefined>;
  renameEntries: (
    renames: Array<{ path: string; nextName: string }>,
  ) => Promise<{ renamed: Map<string, string> } | null | undefined>;
  setSelection: (paths: string[], anchor?: string) => void;
};

export const useAppRenameFlow = ({
  entries,
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
  const [suppressInternalPresence, setSuppressInternalPresence] = useState(false);
  const renameCommitRef = useRef(false);

  const handleRenameCancel = useCallback(() => {
    setRenameTarget(null);
    setRenameValue("");
  }, []);

  const handleRenameCommit = useCallback(
    (reason: RenameCommitReason = "enter") => {
      if (!renameTarget) return;
      if (renameCommitRef.current) return;
      const nextName = renameValue.trim();
      const originalName = renameTarget.name.trim();
      const selectionTargets = getSelectionTargets(selected, viewParentPath);
      const isMultiRename =
        selectionTargets.length > 1 && selectionTargets.includes(renameTarget.path);
      setRenameTarget(null);
      setRenameValue("");
      const hideExtension = gridNameHideExtension && !renameTarget.isDir;
      const resolvedNextName = applyHiddenExtension(
        nextName,
        renameTarget.name,
        hideExtension,
        renameTarget.isDir,
      );
      if (!resolvedNextName || (!isMultiRename && resolvedNextName === originalName)) {
        renameCommitRef.current = false;
        return;
      }
      const shouldSelect = reason === "enter";
      if (!isMultiRename) {
        renameCommitRef.current = true;
        setSuppressInternalPresence(true);
        void renameEntry(renameTarget.path, resolvedNextName)
          .then((nextPath) => {
            if (!nextPath) return;
            if (!shouldSelect) return;
            setSelection([nextPath], nextPath);
          })
          .finally(() => {
            renameCommitRef.current = false;
            setSuppressInternalPresence(false);
          });
        return;
      }

      // Explorer-style bulk rename uses the typed base name and preserves extensions.
      const baseName = renameTarget.isDir
        ? nextName
        : splitNameExtension(nextName).base.trim();
      if (!baseName) {
        renameCommitRef.current = false;
        return;
      }

      const { ordered, plan } = buildBulkRenamePlan(
        baseName,
        selectionTargets,
        entryByPath,
        entries,
        indexMap,
      );
      if (plan.length === 0) {
        renameCommitRef.current = false;
        return;
      }
      renameCommitRef.current = true;
      setSuppressInternalPresence(true);
      void renameEntries(plan)
        .then((result) => {
          if (!result || !shouldSelect) return;
          const renamed = result.renamed;
          const nextSelection = ordered.map((path) => renamed.get(path) ?? path);
          const nextAnchor = renamed.get(renameTarget.path) ?? renameTarget.path;
          setSelection(nextSelection, nextAnchor);
        })
        .finally(() => {
          renameCommitRef.current = false;
          setSuppressInternalPresence(false);
        });
    },
    [
      entries,
      entryByPath,
      gridNameHideExtension,
      indexMap,
      renameEntries,
      renameEntry,
      renameTarget,
      renameValue,
      selected,
      setSelection,
      viewParentPath,
    ],
  );

  return {
    renameTarget,
    renameValue,
    setRenameTarget,
    setRenameValue,
    handleRenameCommit,
    handleRenameCancel,
    suppressInternalPresence,
  };
};
