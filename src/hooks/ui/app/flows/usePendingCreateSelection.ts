// Tracks newly created entries so they can be selected once they appear in view.
import { useCallback, useEffect, useState } from "react";
import { normalizePath } from "@/lib";

type PendingSelection = {
  path: string;
  viewKey: string;
};

type UsePendingCreateSelectionOptions = {
  viewKey: string;
  viewPathKey: string;
  viewLoading: boolean;
  indexMap: Map<string, number>;
  onSelectionChange: (paths: string[], anchor?: string) => void;
  onScrollToIndex: (index: number) => void;
};

export const usePendingCreateSelection = ({
  viewKey,
  viewPathKey,
  viewLoading,
  indexMap,
  onSelectionChange,
  onScrollToIndex,
}: UsePendingCreateSelectionOptions) => {
  const [pendingCreateSelection, setPendingCreateSelection] =
    useState<PendingSelection | null>(null);

  // Select and scroll to freshly created entries once the view updates.
  const queueCreateSelection = useCallback(
    (createdPath: string, parentPath: string) => {
      const parentKey = normalizePath(parentPath);
      if (!parentKey || parentKey !== viewPathKey) return;
      setPendingCreateSelection({ path: createdPath, viewKey });
    },
    [viewKey, viewPathKey],
  );

  useEffect(() => {
    if (!pendingCreateSelection) return;
    if (pendingCreateSelection.viewKey !== viewKey) {
      setPendingCreateSelection(null);
      return;
    }
    if (viewLoading) return;
    const index = indexMap.get(pendingCreateSelection.path);
    if (index == null) return;
    onSelectionChange([pendingCreateSelection.path], pendingCreateSelection.path);
    onScrollToIndex(index);
    setPendingCreateSelection(null);
  }, [
    indexMap,
    onScrollToIndex,
    onSelectionChange,
    pendingCreateSelection,
    viewKey,
    viewLoading,
  ]);

  return { queueCreateSelection };
};
